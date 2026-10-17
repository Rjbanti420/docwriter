import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { db, migrate } from './db.mjs';
import { detect, normalizeKey, findLookalike } from './detect.mjs';
import { mergeFields, newAliasList } from './entitymerge.mjs';
import {
  effectiveNumber,
  chapterLabel,
  resolvePlanned,
  isGunReady,
  isGunSettled,
  gunDecide,
  gunReopen,
  sortGuns,
  normalizeQuestion,
  questionStatus,
  detectQuestions,
  dedupeQuestions,
} from './planning.mjs';

const require = createRequire(import.meta.url);
const ENGLISH_WORDS = new Set(require('an-array-of-english-words'));

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
migrate();

const app = express();
app.use(express.json({ limit: '20mb' }));

const now = "datetime('now')";
const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// ---------- small helpers ----------

function getTypeIdByName() {
  const map = new Map();
  for (const t of db.prepare('SELECT id, name FROM types').all()) map.set(t.name, t.id);
  return map;
}

function getEntityKeyMap() {
  const map = new Map();
  for (const e of db.prepare('SELECT id, name FROM entities WHERE trashed_at IS NULL').all())
    map.set(normalizeKey(e.name), e.id);
  for (const a of db.prepare('SELECT entity_id, alias FROM aliases').all()) map.set(normalizeKey(a.alias), a.entity_id);
  return map;
}

function getIgnoredSet() {
  return new Set(db.prepare('SELECT normalized FROM ignored_tokens').all().map((r) => r.normalized));
}

const insertMentionStmt = db.prepare(
  `INSERT INTO mentions (entity_id, chapter_id, revision_id, start_off, end_off, surface_text, context_sentence)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

function addMention(entityId, chapterId, revisionId, o) {
  insertMentionStmt.run(entityId, chapterId, revisionId, o.start ?? null, o.end ?? null, o.surface ?? '', o.context ?? '');
}

function countChaptersBetween(a, b, inclusiveEnd = false) {
  const row = inclusiveEnd
    ? db.prepare('SELECT COUNT(*) AS n FROM chapters WHERE sort_order > ? AND sort_order <= ?').get(a, b)
    : db.prepare('SELECT COUNT(*) AS n FROM chapters WHERE sort_order > ? AND sort_order < ?').get(a, b);
  return row.n;
}

function parseEntityFields(fields) {
  try {
    const v = JSON.parse(fields || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * A "dead" entity keeps a `fields.death = { chapter, at }` marker. Returns the
 * death chapter row (or null when the entity is alive / its chapter is unknown).
 */
function deathChapterFor(entity) {
  const death = parseEntityFields(entity.fields).death;
  if (!death || typeof death !== 'object' || Array.isArray(death)) return null;
  const chapterId = Number(death.chapter);
  if (!Number.isFinite(chapterId)) return null;
  return db.prepare('SELECT id, number, sort_order FROM chapters WHERE id = ?').get(chapterId) || null;
}

/**
 * Keep an entity's `posthumous` alerts in sync with its death marker: a mention
 * in any chapter *after* the death chapter is a flashback (or a continuity slip)
 * and deserves a look in Review. Dead characters raise no `dormant`/`reappeared`
 * noise — they are gone by definition.
 */
function refreshPosthumous(entityId) {
  const ent = db.prepare('SELECT id, fields, type_id FROM entities WHERE id = ?').get(entityId);
  if (!ent) return;
  // Only people have a fate; any other type is never "posthumous".
  const typeRow = ent.type_id != null ? db.prepare('SELECT name FROM types WHERE id = ?').get(ent.type_id) : null;
  const deathCh = typeRow?.name === 'Character' ? deathChapterFor(ent) : null;

  if (!deathCh) {
    db.prepare("DELETE FROM alerts WHERE entity_id = ? AND kind = 'posthumous'").run(entityId);
    return;
  }

  // Anything at or before the death chapter is no longer posthumous.
  db.prepare(
    `DELETE FROM alerts WHERE entity_id = ? AND kind = 'posthumous'
     AND chapter_id IN (SELECT id FROM chapters WHERE sort_order <= ?)`
  ).run(entityId, deathCh.sort_order);

  const label = `appears after dying in ch.${deathCh.number || deathCh.sort_order + 1}`;
  const after = db
    .prepare(
      `SELECT DISTINCT c.id AS chapter_id FROM mentions m JOIN chapters c ON c.id = m.chapter_id
       WHERE m.entity_id = ? AND c.sort_order > ? ORDER BY c.sort_order`
    )
    .all(entityId, deathCh.sort_order);
  const exists = db.prepare("SELECT id FROM alerts WHERE entity_id = ? AND kind = 'posthumous' AND chapter_id = ?");
  const insert = db.prepare("INSERT INTO alerts (entity_id, kind, chapter_id, detail) VALUES (?, 'posthumous', ?, ?)");
  const update = db.prepare(
    "UPDATE alerts SET detail = ? WHERE entity_id = ? AND kind = 'posthumous' AND chapter_id = ?"
  );
  for (const row of after) {
    if (exists.get(entityId, row.chapter_id)) update.run(label, entityId, row.chapter_id);
    else insert.run(entityId, row.chapter_id, label);
  }
}

function generateAlerts(chapterId) {
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
  if (!chapter) return;
  const tracked = db
    .prepare("SELECT id, name, tracking, gap_threshold, fields FROM entities WHERE tracking IN ('reappearance','absence')")
    .all();

  for (const ent of tracked) {
    const dead = deathChapterFor(ent) !== null;
    const orders = db
      .prepare(
        `SELECT DISTINCT c.sort_order AS o FROM mentions m JOIN chapters c ON c.id = m.chapter_id
         WHERE m.entity_id = ? ORDER BY c.sort_order`
      )
      .all(ent.id)
      .map((r) => r.o);
    const here = orders.includes(chapter.sort_order);
    const threshold = ent.gap_threshold ?? 0;

    if (here) {
      db.prepare("UPDATE alerts SET state = 'resolved' WHERE entity_id = ? AND kind = 'dormant' AND state != 'resolved'").run(ent.id);
    }

    if (ent.tracking === 'reappearance' && here && threshold > 0 && !dead) {
      const prior = orders.filter((o) => o < chapter.sort_order);
      if (prior.length) {
        const gap = countChaptersBetween(prior[prior.length - 1], chapter.sort_order);
        if (gap >= threshold) {
          const exists = db
            .prepare("SELECT id FROM alerts WHERE entity_id = ? AND kind = 'reappeared' AND chapter_id = ? AND state != 'resolved'")
            .get(ent.id, chapterId);
          if (!exists) {
            db.prepare(
              `INSERT INTO alerts (entity_id, kind, chapter_id, detail) VALUES (?, 'reappeared', ?, ?)`
            ).run(ent.id, chapterId, `returns after ${gap} chapter${gap === 1 ? '' : 's'}`);
          }
        }
      }
    }

    if (ent.tracking === 'absence' && !here && threshold > 0 && !dead) {
      const prior = orders.filter((o) => o <= chapter.sort_order);
      if (prior.length) {
        const gap = countChaptersBetween(prior[prior.length - 1], chapter.sort_order, true);
        if (gap >= threshold) {
          const detail = `no appearance for ${gap} chapter${gap === 1 ? '' : 's'}`;
          const existing = db
            .prepare("SELECT id FROM alerts WHERE entity_id = ? AND kind = 'dormant' AND state != 'resolved'")
            .get(ent.id);
          if (existing) db.prepare('UPDATE alerts SET detail = ?, chapter_id = ? WHERE id = ?').run(detail, chapterId, existing.id);
          else db.prepare("INSERT INTO alerts (entity_id, kind, chapter_id, detail) VALUES (?, 'dormant', ?, ?)").run(ent.id, chapterId, detail);
        }
      }
    }
  }

  // Dead characters: mentions after their death chapter become posthumous alerts.
  const dead = db
    .prepare(
      `SELECT e.id FROM entities e
       WHERE e.trashed_at IS NULL AND e.fields LIKE '%"death"%'
         AND e.type_id IN (SELECT id FROM types WHERE name = 'Character')`
    )
    .all();
  for (const ent of dead) refreshPosthumous(ent.id);
}

function runScan(chapterId, revisionId, text) {
  const known = getEntityKeyMap();
  const ignored = getIgnoredSet();
  const { candidates, mentions } = detect(text, known, ignored, ENGLISH_WORDS);

  db.prepare('DELETE FROM mentions WHERE chapter_id = ?').run(chapterId);
  db.prepare("DELETE FROM candidates WHERE chapter_id = ? AND status IN ('pending','later')").run(chapterId);

  let linked = 0;
  for (const m of mentions) {
    const entityId = known.get(m.key);
    if (!entityId) continue;
    addMention(entityId, chapterId, revisionId, m);
    linked += 1;
  }

  const typeIdByName = getTypeIdByName();
  const insertCand = db.prepare(
    `INSERT INTO candidates (chapter_id, revision_id, surface_text, normalized, occurrences, positions, contexts,
       suggested_type_id, confidence, signals, possible_entity_id, tier, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  );

  for (const c of candidates) {
    const typeId = typeIdByName.get(c.suggestedType) ?? typeIdByName.get('Character') ?? null;
    const possible = findLookalike(c.key, known);
    insertCand.run(
      chapterId,
      revisionId,
      c.display,
      c.key,
      c.occurrences,
      JSON.stringify(c.positions),
      JSON.stringify(c.contexts),
      typeId,
      c.confidence,
      JSON.stringify(c.signals),
      possible ?? null,
      c.tier
    );
  }

  generateAlerts(chapterId);
  reconcileGuns();
  db.prepare('INSERT INTO scans (chapter_id, revision_id, found, linked) VALUES (?, ?, ?, ?)').run(
    chapterId,
    revisionId,
    candidates.length,
    linked
  );

  return { found: candidates.length, linked };
}

// Option C: a card that loses its last mention (e.g. its only chapter was
// deleted) is moved to Trash rather than destroyed, so notes are recoverable.
function sweepOrphans() {
  const ids = db
    .prepare(
      `SELECT e.id FROM entities e
       WHERE e.trashed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM mentions m WHERE m.entity_id = e.id)`
    )
    .all()
    .map((r) => r.id);
  const upd = db.prepare("UPDATE entities SET trashed_at = datetime('now') WHERE id = ?");
  for (const id of ids) upd.run(id);
  return ids.length;
}

function chapterRow(id) {
  return db.prepare('SELECT * FROM chapters WHERE id = ?').get(id);
}

function chapterText(id) {
  const chapter = chapterRow(id);
  if (!chapter || !chapter.current_revision_id) return '';
  const rev = db.prepare('SELECT text FROM revisions WHERE id = ?').get(chapter.current_revision_id);
  return rev ? rev.text : '';
}

function chapterMentions(id) {
  return db
    .prepare(
      `SELECT m.id, m.entity_id, m.start_off, m.end_off, m.surface_text,
              e.name, t.color AS type_color, t.name AS type_name
       FROM mentions m
       JOIN entities e ON e.id = m.entity_id
       LEFT JOIN types t ON t.id = e.type_id
       WHERE m.chapter_id = ? AND e.trashed_at IS NULL ORDER BY m.start_off`
    )
    .all(id);
}

// ---------- routes ----------

app.get('/api/types', (_req, res) => {
  res.json(db.prepare('SELECT * FROM types ORDER BY sort_order, name').all());
});

// ---------- power levels (Character) ----------
// A book-wide, user-defined rank ladder. Levels are managed immediately (like
// types); only a character's *assignment* rides the entity Save button.

app.get('/api/power-levels', (_req, res) => {
  res.json(db.prepare('SELECT * FROM power_levels ORDER BY sort_order, name').all());
});

app.post('/api/power-levels', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const color = String(req.body?.color ?? '').trim();
  const max = db.prepare('SELECT MAX(sort_order) AS m FROM power_levels').get().m;
  const order = (max ?? -1) + 1;
  const info = db
    .prepare('INSERT INTO power_levels (name, color, sort_order) VALUES (?, ?, ?)')
    .run(name, color, order);
  res.json({ id: Number(info.lastInsertRowid), name, color, sort_order: order });
});

// A level can be renamed and/or recoloured. Both are immediate (book-wide).
app.put('/api/power-levels/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM power_levels WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const name = req.body?.name == null ? row.name : String(req.body.name).trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const color = req.body?.color == null ? row.color : String(req.body.color).trim();
  db.prepare('UPDATE power_levels SET name = ?, color = ? WHERE id = ?').run(name, color, id);
  res.json({ ok: true, id, name, color });
});

// Deleting a level cannot leave dangling references: every character still
// pointing at it is set back to Unranked (fields.power_level removed).
app.delete('/api/power-levels/:id', (req, res) => {
  const id = Number(req.params.id);
  const setFields = db.prepare("UPDATE entities SET fields = ?, updated_at = datetime('now') WHERE id = ?");
  let cleared = 0;
  for (const row of db.prepare('SELECT id, fields FROM entities').all()) {
    const fields = parseEntityFields(row.fields);
    if (fields.power_level === id) {
      delete fields.power_level;
      setFields.run(JSON.stringify(fields), row.id);
      cleared += 1;
    }
  }
  db.prepare('DELETE FROM power_levels WHERE id = ?').run(id);
  res.json({ ok: true, cleared });
});


app.get('/api/chapters', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM mentions m WHERE m.chapter_id = c.id) AS mention_count,
              (SELECT COUNT(*) FROM candidates k WHERE k.chapter_id = c.id AND k.status IN ('pending','later')) AS candidate_count
       FROM chapters c ORDER BY c.sort_order`
    )
    .all();
  res.json(rows);
});

app.post('/api/chapters', (req, res) => {
  const { number = '', title = '', text = '' } = req.body ?? {};
  const max = db.prepare('SELECT MAX(sort_order) AS m FROM chapters').get().m;
  const order = (max ?? -1) + 1;
  const info = db
    .prepare("INSERT INTO chapters (number, title, sort_order, word_count, updated_at) VALUES (?, ?, ?, ?, datetime('now'))")
    .run(String(number), String(title), order, wordCount(text));
  const chapterId = Number(info.lastInsertRowid);

  const rev = db.prepare('INSERT INTO revisions (chapter_id, text) VALUES (?, ?)').run(chapterId, text);
  const revisionId = Number(rev.lastInsertRowid);
  db.prepare('UPDATE chapters SET current_revision_id = ? WHERE id = ?').run(revisionId, chapterId);

  const scan = runScan(chapterId, revisionId, text);
  res.json({ chapter: chapterRow(chapterId), scan });
});

app.get('/api/chapters/:id', (req, res) => {
  const id = Number(req.params.id);
  const chapter = chapterRow(id);
  if (!chapter) return res.status(404).json({ error: 'not found' });
  const candidates = db
    .prepare(
      `SELECT id, surface_text, normalized, positions, confidence, suggested_type_id, possible_entity_id, tier, status
       FROM candidates WHERE chapter_id = ? AND status IN ('pending','later') AND tier = 'primary'
       ORDER BY confidence DESC`
    )
    .all(id);
  res.json({ chapter, text: chapterText(id), mentions: chapterMentions(id), candidates });
});

app.put('/api/chapters/:id', (req, res) => {
  const id = Number(req.params.id);
  const chapter = chapterRow(id);
  if (!chapter) return res.status(404).json({ error: 'not found' });
  const { text, number, title } = req.body ?? {};
  if (number !== undefined || title !== undefined) {
    db.prepare('UPDATE chapters SET number = COALESCE(?, number), title = COALESCE(?, title) WHERE id = ?').run(
      number === undefined ? null : String(number),
      title === undefined ? null : String(title),
      id
    );
  }
  let scan = null;
  if (typeof text === 'string') {
    const rev = db.prepare('INSERT INTO revisions (chapter_id, text) VALUES (?, ?)').run(id, text);
    const revisionId = Number(rev.lastInsertRowid);
    db.prepare("UPDATE chapters SET current_revision_id = ?, word_count = ?, updated_at = datetime('now') WHERE id = ?").run(
      revisionId,
      wordCount(text),
      id
    );
    scan = runScan(id, revisionId, text);
  }
  reconcileGuns();
  res.json({ chapter: chapterRow(id), scan });
});

app.delete('/api/chapters/:id', (req, res) => {
  const id = Number(req.params.id);
  const chapter = chapterRow(id);
  if (!chapter) return res.status(404).json({ error: 'not found' });
  const renumber = req.query.renumber === '1' || req.query.renumber === 'true';

  db.prepare('DELETE FROM chapters WHERE id = ?').run(id);

  if (renumber) {
    const rest = db.prepare('SELECT id, number, sort_order FROM chapters ORDER BY sort_order').all();
    const upd = db.prepare('UPDATE chapters SET sort_order = ?, number = ? WHERE id = ?');
    rest.forEach((c, i) => {
      const num = /^\d+$/.test(c.number) ? String(i + 1) : c.number;
      upd.run(i, num, c.id);
    });
  }
  const trashed = sweepOrphans();
  reconcileGuns();
  res.json({ ok: true, trashed });
});

app.get('/api/review', (_req, res) => {
  const pending = db
    .prepare(
      `SELECT k.*, c.number AS chapter_number, c.title AS chapter_title, t.name AS type_name, t.color AS type_color,
              pe.name AS possible_name
       FROM candidates k
       JOIN chapters c ON c.id = k.chapter_id
       LEFT JOIN types t ON t.id = k.suggested_type_id
       LEFT JOIN entities pe ON pe.id = k.possible_entity_id
       WHERE k.status IN ('pending','later')
       ORDER BY k.confidence DESC, k.occurrences DESC`
    )
    .all();

  const alerts = db
    .prepare(
      `SELECT a.*, e.name AS entity_name, t.color AS type_color, c.number AS chapter_number,
              g.title AS gun_title
       FROM alerts a
       LEFT JOIN entities e ON e.id = a.entity_id
       LEFT JOIN types t ON t.id = e.type_id
       LEFT JOIN chapters c ON c.id = a.chapter_id
       LEFT JOIN guns g ON g.id = a.gun_id
       WHERE a.state != 'resolved'
       ORDER BY a.created_at DESC`
    )
    .all();

  res.json({ pending, alerts });
});

app.post('/api/candidates/:id/resolve', (req, res) => {
  const id = Number(req.params.id);
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
  if (!candidate) return res.status(404).json({ error: 'not found' });
  const { action, typeId, name, tracking = 'off', gapThreshold = null } = req.body ?? {};

  if (action === 'later') {
    db.prepare("UPDATE candidates SET status = 'later' WHERE id = ?").run(id);
    return res.json({ ok: true });
  }

  if (action === 'ignore') {
    db.prepare('INSERT OR IGNORE INTO ignored_tokens (normalized) VALUES (?)').run(candidate.normalized);
    db.prepare("UPDATE candidates SET status = 'ignored' WHERE normalized = ? AND status IN ('pending','later')").run(candidate.normalized);
    return res.json({ ok: true });
  }

  if (action === 'merge') {
    const targetId = Number(req.body?.entityId);
    const target = db.prepare('SELECT * FROM entities WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'target entity not found' });
    if (normalizeKey(target.name) !== candidate.normalized) {
      db.prepare('INSERT INTO aliases (entity_id, alias) VALUES (?, ?)').run(targetId, candidate.surface_text);
    }
    const siblings = db
      .prepare("SELECT * FROM candidates WHERE normalized = ? AND status IN ('pending','later')")
      .all(candidate.normalized);
    for (const sib of siblings) {
      const positions = JSON.parse(sib.positions || '[]');
      for (const p of positions) addMention(targetId, sib.chapter_id, sib.revision_id, p);
      db.prepare("UPDATE candidates SET status = 'accepted', entity_id = ? WHERE id = ?").run(targetId, sib.id);
    }
    for (const chapter of db.prepare('SELECT DISTINCT chapter_id FROM mentions WHERE entity_id = ?').all(targetId)) {
      generateAlerts(chapter.chapter_id);
    }
    return res.json({ ok: true, entityId: targetId });
  }

  if (action === 'accept') {
    const entityName = (name || candidate.surface_text).trim();
    const resolvedTypeId = typeId ?? candidate.suggested_type_id ?? null;
    const threshold = tracking === 'off' ? null : gapThreshold ?? null;
    const info = db
      .prepare('INSERT INTO entities (name, type_id, tracking, gap_threshold, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
      .run(entityName, resolvedTypeId, tracking, threshold);
    const entityId = Number(info.lastInsertRowid);

    // Attach this candidate and any other pending candidate with the same name.
    const siblings = db
      .prepare("SELECT * FROM candidates WHERE normalized = ? AND status IN ('pending','later')")
      .all(candidate.normalized);
    for (const sib of siblings) {
      const positions = JSON.parse(sib.positions || '[]');
      for (const p of positions) addMention(entityId, sib.chapter_id, sib.revision_id, p);
      db.prepare("UPDATE candidates SET status = 'accepted', entity_id = ? WHERE id = ?").run(entityId, sib.id);
    }

    for (const chapter of db.prepare('SELECT DISTINCT chapter_id FROM mentions WHERE entity_id = ?').all(entityId)) {
      generateAlerts(chapter.chapter_id);
    }
    return res.json({ ok: true, entityId });
  }

  res.status(400).json({ error: 'unknown action' });
});

app.get('/api/entities', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT e.*, t.name AS type_name, t.color AS type_color, t.icon AS type_icon,
        (SELECT COUNT(*) FROM mentions m WHERE m.entity_id = e.id) AS mention_count,
        (SELECT c.number FROM mentions m JOIN chapters c ON c.id = m.chapter_id WHERE m.entity_id = e.id ORDER BY c.sort_order LIMIT 1) AS first_chapter,
        (SELECT c.number FROM mentions m JOIN chapters c ON c.id = m.chapter_id WHERE m.entity_id = e.id ORDER BY c.sort_order DESC LIMIT 1) AS last_chapter
       FROM entities e LEFT JOIN types t ON t.id = e.type_id
       WHERE e.trashed_at IS NULL
       ORDER BY t.sort_order, e.name COLLATE NOCASE`
    )
    .all();
  res.json(rows);
});

app.post('/api/entities', (req, res) => {
  const { name, typeId, tracking = 'off', gapThreshold = null, summary = '' } = req.body ?? {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  const threshold = tracking === 'off' ? null : gapThreshold ?? null;
  if (tracking !== 'off' && !threshold) return res.status(400).json({ error: 'gap threshold required' });
  const info = db
    .prepare("INSERT INTO entities (name, type_id, summary, tracking, gap_threshold, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
    .run(String(name).trim(), typeId ?? null, summary, tracking, threshold);
  res.json({ id: Number(info.lastInsertRowid) });
});

app.get('/api/entities/:id', (req, res) => {
  const id = Number(req.params.id);
  const entity = db
    .prepare(
      `SELECT e.*, t.name AS type_name, t.color AS type_color, t.icon AS type_icon
       FROM entities e LEFT JOIN types t ON t.id = e.type_id WHERE e.id = ?`
    )
    .get(id);
  if (!entity) return res.status(404).json({ error: 'not found' });
  const aliases = db.prepare('SELECT * FROM aliases WHERE entity_id = ?').all(id);
  const mentions = db
    .prepare(
      `SELECT m.id, m.chapter_id, m.start_off, m.end_off, m.surface_text, m.context_sentence,
              c.number AS chapter_number, c.title AS chapter_title, c.sort_order AS chapter_order
       FROM mentions m JOIN chapters c ON c.id = m.chapter_id
       WHERE m.entity_id = ? ORDER BY c.sort_order, m.start_off`
    )
    .all(id);
  res.json({ entity, aliases, mentions });
});

app.put('/api/entities/:id', (req, res) => {
  const id = Number(req.params.id);
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
  if (!entity) return res.status(404).json({ error: 'not found' });
  const { name, typeId, summary, fields, tracking, gapThreshold } = req.body ?? {};
  const nextTracking = tracking ?? entity.tracking;
  const nextThreshold = nextTracking === 'off' ? null : gapThreshold ?? entity.gap_threshold ?? null;
  db.prepare(
    `UPDATE entities SET name = ?, type_id = ?, summary = ?, fields = ?, tracking = ?, gap_threshold = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name ?? entity.name,
    typeId ?? entity.type_id,
    summary ?? entity.summary,
    fields !== undefined ? JSON.stringify(fields) : entity.fields,
    nextTracking,
    nextThreshold,
    id
  );
  if (fields !== undefined) {
    // Kill / resurrect (or edit the death chapter) — keep posthumous alerts honest.
    refreshPosthumous(id);
    const deadNow = deathChapterFor(db.prepare('SELECT fields FROM entities WHERE id = ?').get(id));
    if (deadNow) {
      db.prepare("UPDATE alerts SET state = 'resolved' WHERE entity_id = ? AND kind = 'dormant' AND state != 'resolved'").run(id);
    }
  }
  res.json({ ok: true });
});

app.delete('/api/entities/:id', (req, res) => {
  db.prepare('DELETE FROM entities WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Soft delete: move one or more entities to Trash (recoverable), like the orphan
// sweep. Mentions are kept so a restore re-highlights without a re-scan.
app.post('/api/entities/trash', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'ids required' });
  const trash = db.prepare("UPDATE entities SET trashed_at = datetime('now') WHERE id = ? AND trashed_at IS NULL");
  const resolve = db.prepare("UPDATE alerts SET state = 'resolved' WHERE entity_id = ? AND state != 'resolved'");
  const clearPosthumous = db.prepare("DELETE FROM alerts WHERE entity_id = ? AND kind = 'posthumous'");
  let trashed = 0;
  for (const id of ids) {
    trashed += trash.run(id).changes ?? 0;
    resolve.run(id);
    clearPosthumous.run(id);
  }
  res.json({ ok: true, trashed });
});

app.post('/api/entities/:id/aliases', (req, res) => {
  const id = Number(req.params.id);
  const alias = String(req.body?.alias ?? '').trim();
  if (!alias) return res.status(400).json({ error: 'alias required' });
  const info = db.prepare('INSERT INTO aliases (entity_id, alias) VALUES (?, ?)').run(id, alias);
  res.json({ id: Number(info.lastInsertRowid), entity_id: id, alias });
});

app.delete('/api/entities/:id/aliases/:aliasId', (req, res) => {
  db.prepare('DELETE FROM aliases WHERE id = ? AND entity_id = ?').run(Number(req.params.aliasId), Number(req.params.id));
  res.json({ ok: true });
});

// Merge: A absorbs B. Everything B owns moves onto A — its name becomes an
// alias, so from now on both spellings resolve to A — and B's card is dropped
// in Trash. There is no unmerge: Trash keeps B's original card, but its
// mentions, aliases and cross-references now live on the survivor.
app.post('/api/entities/:id/merge', (req, res) => {
  const id = Number(req.params.id);
  const absorbedId = Number(req.body?.absorbedId);
  if (!Number.isFinite(absorbedId) || absorbedId === id) {
    return res.status(400).json({ error: 'a different entity to absorb is required' });
  }
  const a = db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
  const b = db.prepare('SELECT * FROM entities WHERE id = ?').get(absorbedId);
  if (!a || !b) return res.status(404).json({ error: 'not found' });
  if (a.trashed_at || b.trashed_at) return res.status(400).json({ error: 'cannot merge a trashed entity' });

  // 1. Identity: A's opinions win, B fills the blanks — fields, summary, type
  //    and tracking all follow the same "take it when A has nothing" rule.
  let tracking = a.tracking;
  let threshold = a.gap_threshold;
  if (tracking === 'off' && b.tracking !== 'off') {
    tracking = b.tracking;
    threshold = b.gap_threshold;
  }
  if (tracking !== 'off' && threshold == null) threshold = b.gap_threshold ?? a.gap_threshold ?? null;
  if (tracking === 'off') threshold = null;

  db.prepare(
    `UPDATE entities SET summary = ?, type_id = ?, fields = ?, tracking = ?, gap_threshold = ?,
       updated_at = datetime('now') WHERE id = ?`
  ).run(
    (a.summary || '').trim() ? a.summary : b.summary,
    a.type_id ?? b.type_id,
    JSON.stringify(mergeFields(a.fields, b.fields)),
    tracking,
    threshold,
    id
  );

  // 2. B's name and its aliases become A's aliases (deduped by the key the
  //    scanner uses, so a spelling A already owns is not added twice).
  const listAliases = (entityId) =>
    db.prepare('SELECT alias FROM aliases WHERE entity_id = ?').all(entityId).map((r) => r.alias);
  const added = newAliasList(a.name, listAliases(id), b.name, listAliases(absorbedId));
  const insertAlias = db.prepare('INSERT INTO aliases (entity_id, alias) VALUES (?, ?)');
  for (const alias of added) insertAlias.run(id, alias);
  db.prepare('DELETE FROM aliases WHERE entity_id = ?').run(absorbedId);

  // 3. Mentions move over, after dropping any that already sit on A at the
  //    exact same span (belt and braces — one span normally maps to one card).
  db.prepare(
    `DELETE FROM mentions WHERE entity_id = ? AND EXISTS (
       SELECT 1 FROM mentions m2 WHERE m2.entity_id = ? AND m2.chapter_id = mentions.chapter_id
         AND m2.start_off IS mentions.start_off AND m2.end_off IS mentions.end_off
         AND m2.start_off IS NOT NULL AND m2.end_off IS NOT NULL
     )`
  ).run(absorbedId, id);
  const movedMentions = db.prepare('UPDATE mentions SET entity_id = ? WHERE entity_id = ?').run(id, absorbedId).changes;

  // 4. Alerts: B's are closed out (its card is gone), then A's are rebuilt from
  //    the merged reality so dormant/posthumous/gap stay honest.
  db.prepare("UPDATE alerts SET state = 'resolved' WHERE entity_id = ? AND state != 'resolved'").run(absorbedId);
  db.prepare("DELETE FROM alerts WHERE entity_id = ? AND kind = 'posthumous'").run(absorbedId);
  for (const row of db.prepare('SELECT DISTINCT chapter_id FROM mentions WHERE entity_id = ?').all(id)) {
    generateAlerts(row.chapter_id);
  }
  refreshPosthumous(id);

  // 5. Cross-references: anything B owned now belongs to A; Organisation
  //    relations pointing at B (leader / members / operates_in) now point at A.
  const setFields = db.prepare("UPDATE entities SET fields = ?, updated_at = datetime('now') WHERE id = ?");
  let ownersRepointed = 0;
  for (const row of db.prepare('SELECT id, fields FROM entities').all()) {
    const fields = parseEntityFields(row.fields);
    const self = row.id === id;
    let touched = false;
    if (!self && fields.owner === absorbedId) {
      fields.owner = id;
      touched = true;
      ownersRepointed += 1;
    }
    // Relations never point at the entity itself, so a reference the survivor
    // held to the absorbed entity is dropped rather than made self-referential.
    if (fields.leader === absorbedId) {
      if (self) delete fields.leader;
      else fields.leader = id;
      touched = true;
    }
    if (fields.operates_in === absorbedId) {
      if (self) delete fields.operates_in;
      else fields.operates_in = id;
      touched = true;
    }
    if (Array.isArray(fields.members) && fields.members.includes(absorbedId)) {
      const next = [...new Set(fields.members.map((m) => (m === absorbedId ? id : m)))].filter((m) => m !== row.id);
      if (next.length > 0) fields.members = next;
      else delete fields.members;
      touched = true;
    }
    if (touched) setFields.run(JSON.stringify(fields), row.id);
  }

  // 6. Review candidates keep pointing at the survivor.
  db.prepare('UPDATE candidates SET entity_id = ? WHERE entity_id = ?').run(id, absorbedId);
  db.prepare('UPDATE candidates SET possible_entity_id = ? WHERE possible_entity_id = ?').run(id, absorbedId);

  // 7. B goes to Trash, exactly like the Trash flow (recoverable, not destroyed).
  db.prepare("UPDATE entities SET trashed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(
    absorbedId
  );

  res.json({
    ok: true,
    entityId: id,
    absorbedId,
    aliasesAdded: added,
    mentionsMoved: movedMentions,
    ownersRepointed,
  });
});

app.get('/api/trash', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT e.*, t.name AS type_name, t.color AS type_color, t.icon AS type_icon,
        (SELECT COUNT(*) FROM mentions m WHERE m.entity_id = e.id) AS mention_count
       FROM entities e LEFT JOIN types t ON t.id = e.type_id
       WHERE e.trashed_at IS NOT NULL ORDER BY e.trashed_at DESC`
    )
    .all();
  res.json(rows);
});

app.post('/api/entities/:id/restore', (req, res) => {
  db.prepare('UPDATE entities SET trashed_at = NULL WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/ignored', (_req, res) => {
  res.json(db.prepare('SELECT * FROM ignored_tokens ORDER BY normalized').all());
});

app.delete('/api/ignored/:id', (req, res) => {
  db.prepare('DELETE FROM ignored_tokens WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/alerts/:id/state', (req, res) => {
  const state = String(req.body?.state ?? 'read');
  db.prepare('UPDATE alerts SET state = ? WHERE id = ?').run(state, Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Chekhov's Guns ----------

function chapterList() {
  return db.prepare('SELECT * FROM chapters').all();
}

// Resolve the planned chapter for display and flag whether the gun is due now.
function withGunState(gun, chapters) {
  const planned = resolvePlanned(gun, chapters);
  return { ...gun, planned_chapter_id: planned ? planned.id : null, ready: isGunReady(gun, chapters) };
}

function allGunsWithState() {
  const chapters = chapterList();
  return sortGuns(db.prepare('SELECT * FROM guns').all()).map((g) => withGunState(g, chapters));
}

function gunReadyDetail(gun, chapter) {
  return `Gun ready for payoff — ${gun.title} (${chapterLabel(chapter)})`;
}

function armGunAlert(gun, chapter) {
  const existing = db
    .prepare("SELECT id FROM alerts WHERE gun_id = ? AND kind = 'gun_ready' AND chapter_id = ? AND state != 'resolved'")
    .get(gun.id, chapter.id);
  const detail = gunReadyDetail(gun, chapter);
  if (existing) {
    db.prepare('UPDATE alerts SET detail = ? WHERE id = ?').run(detail, existing.id);
    return;
  }
  db.prepare("INSERT INTO alerts (entity_id, gun_id, kind, chapter_id, detail) VALUES (NULL, ?, 'gun_ready', ?, ?)").run(
    gun.id,
    chapter.id,
    detail
  );
}

/**
 * Keep every gun's resolved planned chapter — and its notification — in step
 * with the current chapter list. Idempotent and cheap, so it runs after any
 * change to chapters or guns (create, renumber, delete, edit, decide, fire).
 */
function reconcileGuns() {
  const chapters = chapterList();
  const guns = db.prepare('SELECT * FROM guns').all();
  const setPlanned = db.prepare('UPDATE guns SET planned_chapter_id = ?, planned_number = ? WHERE id = ?');
  for (const gun of guns) {
    const planned = resolvePlanned(gun, chapters);
    const nextId = planned ? planned.id : null;
    // A gun linked to a real chapter follows it (and its renumbering); one still
    // waiting keeps the number the author typed.
    const nextNumber = planned ? effectiveNumber(planned) : String(gun.planned_number ?? '');
    if (nextId !== gun.planned_chapter_id || nextNumber !== gun.planned_number) {
      setPlanned.run(nextId, nextNumber, gun.id);
    }
    if (planned && !isGunSettled(gun)) armGunAlert(gun, planned);
  }
}

// Close any pending gun notification, e.g. once the outcome is recorded.
function resolveGunAlerts(gunId) {
  db.prepare("UPDATE alerts SET state = 'resolved' WHERE gun_id = ? AND kind = 'gun_ready' AND state != 'resolved'").run(gunId);
}

function insertGunHistory(gunId, chapter, decision, fromNumber, toNumber) {
  db.prepare(
    'INSERT INTO gun_history (gun_id, chapter_id, chapter_label, decision, from_number, to_number) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(gunId, chapter?.id ?? null, chapterLabel(chapter), decision, String(fromNumber ?? ''), String(toNumber ?? ''));
}

app.get('/api/guns', (_req, res) => {
  res.json(allGunsWithState());
});

app.get('/api/guns/:id', (req, res) => {
  const gun = db.prepare('SELECT * FROM guns WHERE id = ?').get(Number(req.params.id));
  if (!gun) return res.status(404).json({ error: 'not found' });
  const history = db
    .prepare('SELECT * FROM gun_history WHERE gun_id = ? ORDER BY created_at DESC, id DESC')
    .all(gun.id);
  res.json({ gun: withGunState(gun, chapterList()), history });
});

app.post('/api/guns', (req, res) => {
  const { title, explanation = '', impact = '', appearanceChapterId = null, plannedNumber = '' } = req.body ?? {};
  const cleanTitle = String(title ?? '').trim();
  if (!cleanTitle) return res.status(400).json({ error: 'title required' });
  const info = db
    .prepare(
      `INSERT INTO guns (title, explanation, impact, appearance_chapter_id, planned_number, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      cleanTitle,
      String(explanation ?? ''),
      String(impact ?? ''),
      appearanceChapterId ?? null,
      String(plannedNumber ?? '').trim()
    );
  reconcileGuns();
  res.json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/guns/:id', (req, res) => {
  const id = Number(req.params.id);
  const gun = db.prepare('SELECT * FROM guns WHERE id = ?').get(id);
  if (!gun) return res.status(404).json({ error: 'not found' });
  const { title, explanation, impact, appearanceChapterId, plannedNumber } = req.body ?? {};
  const nextTitle = title !== undefined ? String(title).trim() : gun.title;
  if (!nextTitle) return res.status(400).json({ error: 'title required' });
  db.prepare(
    `UPDATE guns SET title = ?, explanation = ?, impact = ?, appearance_chapter_id = ?, planned_number = ?, planned_chapter_id = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    nextTitle,
    explanation !== undefined ? String(explanation) : gun.explanation,
    impact !== undefined ? String(impact) : gun.impact,
    appearanceChapterId !== undefined ? appearanceChapterId ?? null : gun.appearance_chapter_id,
    plannedNumber !== undefined ? String(plannedNumber).trim() : gun.planned_number,
    // A new target number invalidates the old link; reconcile re-resolves it.
    plannedNumber !== undefined ? null : gun.planned_chapter_id,
    id
  );
  reconcileGuns();
  res.json({ ok: true });
});

app.delete('/api/guns/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM alerts WHERE gun_id = ?').run(id);
  db.prepare('DELETE FROM guns WHERE id = ?').run(id); // gun_history cascades
  res.json({ ok: true });
});

// Record the outcome when the planned chapter arrives: Used = paid off, Discussed
// = raised but deferred. Discussed shifts the plan and re-arms; Used stops the
// notifications but is revisitable (see /reopen below). Fired is the permanent one.
app.post('/api/guns/:id/decide', (req, res) => {
  const id = Number(req.params.id);
  const gun = db.prepare('SELECT * FROM guns WHERE id = ?').get(id);
  if (!gun) return res.status(404).json({ error: 'not found' });
  const decision = String(req.body?.decision ?? '');
  if (decision !== 'used' && decision !== 'discussed') {
    return res.status(400).json({ error: 'decision must be "used" or "discussed"' });
  }

  const chapters = chapterList();
  const chapterId = Number(req.body?.chapterId);
  const chapter = Number.isFinite(chapterId)
    ? chapters.find((c) => c.id === chapterId) ?? null
    : resolvePlanned(gun, chapters);

  const { gun: next, history } = gunDecide(gun, decision, req.body?.newNumber ?? '', chapter);
  db.prepare(
    "UPDATE guns SET outcome = ?, planned_number = ?, planned_chapter_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(next.outcome, next.planned_number, next.planned_chapter_id ?? null, id);
  insertGunHistory(id, chapter, history.decision, history.from_number, history.to_number);
  resolveGunAlerts(id);
  reconcileGuns();
  res.json({ ok: true, gun: db.prepare('SELECT * FROM guns WHERE id = ?').get(id) });
});

app.post('/api/guns/:id/fire', (req, res) => {
  const id = Number(req.params.id);
  const gun = db.prepare('SELECT * FROM guns WHERE id = ?').get(id);
  if (!gun) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE guns SET status = 'fired', fired_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
  insertGunHistory(id, null, 'fired', gun.planned_number, '');
  resolveGunAlerts(id);
  res.json({ ok: true });
});

// Fired is the permanent close — there is no unfire. Used is the reversible
// acknowledgment: it stops the notifications, but the payoff record can be
// revisited and put back in play, which re-arms the gun if its chapter is due.
app.post('/api/guns/:id/reopen', (req, res) => {
  const id = Number(req.params.id);
  const gun = db.prepare('SELECT * FROM guns WHERE id = ?').get(id);
  if (!gun) return res.status(404).json({ error: 'not found' });
  const { gun: next, history } = gunReopen(gun);
  db.prepare('UPDATE guns SET outcome = ?, updated_at = datetime(\'now\') WHERE id = ?').run(next.outcome, id);
  insertGunHistory(id, null, history.decision, history.from_number, history.to_number);
  reconcileGuns();
  res.json({ ok: true });
});

// ---------- Questions ----------

function allQuestions() {
  return db
    .prepare(
      `SELECT q.*, sc.number AS source_chapter_number, dc.number AS delivered_chapter_number
       FROM questions q
       LEFT JOIN chapters sc ON sc.id = q.source_chapter_id
       LEFT JOIN chapters dc ON dc.id = q.delivered_chapter_id
       ORDER BY q.created_at DESC, q.id DESC`
    )
    .all()
    .map((q) => ({ ...q, status: questionStatus(q) }));
}

app.get('/api/questions', (_req, res) => {
  res.json(allQuestions());
});

app.post('/api/questions', (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const info = db
    .prepare(
      `INSERT INTO questions (text, answer, source_chapter_id, delivered_chapter_id, origin, updated_at)
       VALUES (?, ?, ?, ?, 'manual', datetime('now'))`
    )
    .run(text, String(req.body?.answer ?? ''), req.body?.sourceChapterId ?? null, req.body?.deliveredChapterId ?? null);
  res.json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/questions/:id', (req, res) => {
  const id = Number(req.params.id);
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!q) return res.status(404).json({ error: 'not found' });
  const { text, answer, sourceChapterId, deliveredChapterId } = req.body ?? {};
  const nextText = text !== undefined ? String(text).trim() : q.text;
  if (!nextText) return res.status(400).json({ error: 'text required' });
  db.prepare(
    `UPDATE questions SET text = ?, answer = ?, source_chapter_id = ?, delivered_chapter_id = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    nextText,
    answer !== undefined ? String(answer) : q.answer,
    sourceChapterId !== undefined ? sourceChapterId ?? null : q.source_chapter_id,
    deliveredChapterId !== undefined ? deliveredChapterId ?? null : q.delivered_chapter_id,
    id
  );
  res.json({ ok: true });
});

app.delete('/api/questions/:id', (req, res) => {
  db.prepare('DELETE FROM questions WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Scan selected chapters for the questions their prose raises. Results land in
// question_candidates for review; anything already asked, queued, or dismissed
// for that chapter is skipped.
app.post('/api/questions/scan', (req, res) => {
  const ids = Array.isArray(req.body?.chapterIds) ? req.body.chapterIds.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'chapterIds required' });

  const insert = db.prepare('INSERT INTO question_candidates (chapter_id, text, normalized) VALUES (?, ?, ?)');
  let created = 0;
  let skipped = 0;
  const chapters = [];
  for (const chapterId of ids) {
    const chapter = chapterRow(chapterId);
    if (!chapter) continue;
    const known = [
      ...db.prepare('SELECT text FROM questions WHERE source_chapter_id = ?').all(chapterId),
      ...db.prepare('SELECT text FROM question_candidates WHERE chapter_id = ?').all(chapterId),
    ].map((r) => normalizeQuestion(r.text));

    const found = detectQuestions(chapterText(chapterId));
    const kept = dedupeQuestions(found, known);
    for (const k of kept) insert.run(chapterId, k.text, k.normalized);
    created += kept.length;
    skipped += found.length - kept.length;
    chapters.push({ chapterId, found: found.length, created: kept.length });
  }
  res.json({ created, skipped, chapters });
});

app.get('/api/questions/candidates', (req, res) => {
  const status = String(req.query.status ?? 'pending');
  const rows = db
    .prepare(
      `SELECT k.*, c.number AS chapter_number, c.title AS chapter_title
       FROM question_candidates k JOIN chapters c ON c.id = k.chapter_id
       WHERE k.status = ? ORDER BY c.sort_order, k.id`
    )
    .all(status);
  res.json(rows);
});

app.post('/api/questions/candidates/:id/resolve', (req, res) => {
  const id = Number(req.params.id);
  const cand = db.prepare('SELECT * FROM question_candidates WHERE id = ?').get(id);
  if (!cand) return res.status(404).json({ error: 'not found' });
  const action = String(req.body?.action ?? '');

  if (action === 'reject') {
    db.prepare("UPDATE question_candidates SET status = 'rejected' WHERE id = ?").run(id);
    return res.json({ ok: true });
  }

  if (action === 'accept') {
    const text = String(req.body?.text ?? cand.text).trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    const sourceChapterId =
      req.body?.sourceChapterId !== undefined ? req.body.sourceChapterId ?? null : cand.chapter_id;
    const info = db
      .prepare(
        `INSERT INTO questions (text, answer, source_chapter_id, delivered_chapter_id, origin, updated_at)
         VALUES (?, ?, ?, NULL, 'scan', datetime('now'))`
      )
      .run(text, String(req.body?.answer ?? ''), sourceChapterId);
    const questionId = Number(info.lastInsertRowid);
    db.prepare("UPDATE question_candidates SET status = 'accepted', question_id = ? WHERE id = ?").run(questionId, id);
    return res.json({ ok: true, questionId });
  }

  res.status(400).json({ error: 'action must be "accept" or "reject"' });
});

// ---------- static (production build, if present) ----------

const dist = join(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.get('/api/projects', (_req,res)=>{ try{ const regPath=join(join(process.env.HOME || '/home/rj', '.config', 'docwriter'),'projects.json'); let list=[]; if(existsSync(regPath)){ list=JSON.parse(readFileSync(regPath,'utf8')); } res.json(list);}catch(e){res.status(500).json({error:String(e)});} });
app.post('/api/projects/switch', (req,res)=>{ try{ const p=req.body?.path; if(!p) return res.status(400).json({error:'path required'}); writeSettings({dbPath:p}); res.json({ok:true}); }catch(e){res.status(500).json({error:String(e)});} });
app.get('/api/backup', (_req,res)=>{ try{ const dbPath=process.env.DOCWRITER_DB||join(dataDir,'docwriter.db'); const buf=readFileSync(dbPath); res.set('Content-Disposition','attachment; filename="docwriter-backup.db"'); res.set('Content-Type','application/octet-stream'); res.send(buf); }catch(e){res.status(500).json({error:String(e)});} });
app.post('/api/backup/import', (req,res)=>{ res.status(501).json({error:'import not implemented in stub'}); });
const PORT = Number(process.env.PORT ?? 5178);
const HOST = process.env.HOST || undefined;
const onListen = () => console.log(`[server] listening on http://${HOST || 'localhost'}:${PORT}`);
if (HOST) app.listen(PORT, HOST, onListen);
else app.listen(PORT, onListen);
