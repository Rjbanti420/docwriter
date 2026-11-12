import express from 'express';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomInt } from 'node:crypto';
import { db, migrate } from './db.mjs';
import { detect, normalizeKey, findLookalike, buildLookalikeIndex } from './detect.mjs';
import { mergeFields, newAliasList, repointReferences } from './entitymerge.mjs';
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
import { isNudgeDue, NUDGE_FREQUENCIES } from './nudge.mjs';
import { renderBookMarkdownChunks } from './exportmd.mjs';
import { MAX_FIGHTERS_PER_SIDE, resolveDuel, snapshotCombatants } from './duel.mjs';
import { detectGunCandidates } from './gunscan.mjs';
import { extractEventCandidates } from './timeline-extract.mjs';

const require = createRequire(import.meta.url);
const ENGLISH_WORDS = new Set(require('an-array-of-english-words'));

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
migrate();

const app = express();
app.use(express.json({ limit: '20mb' }));

// Every write request runs inside one SQLite transaction, so a multi-step write
// (a merge across five tables, a chapter re-scan) either lands whole or not at
// all. Without this a crash half-way leaves a half-merged card, and merges have
// no undo. Handlers here are synchronous, so the transaction opens and settles
// inside the request; GETs are left alone.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  db.exec('BEGIN');
  let settled = false;
  const settle = (commit) => {
    if (settled) return;
    settled = true;
    try {
      db.exec(commit ? 'COMMIT' : 'ROLLBACK');
    } catch {
      /* nothing left to settle */
    }
  };
  // Settle before the body goes out, so only a write that actually committed is
  // reported as done. A 5xx means a handler threw part-way through.
  const send = res.send.bind(res);
  res.send = (body) => {
    settle(res.statusCode < 500);
    return send(body);
  };
  res.on('close', () => settle(false)); // client hung up / handler never replied
  next();
});

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
  // A hidden card must not keep swallowing its alias: only live owners count.
  for (const a of db
    .prepare(
      `SELECT a.entity_id, a.alias FROM aliases a
       JOIN entities e ON e.id = a.entity_id
       WHERE e.trashed_at IS NULL`
    )
    .all())
    map.set(normalizeKey(a.alias), a.entity_id);
  return map;
}

// The id already answering to this spelling, if any. Aliases count, so a new
// card cannot silently shadow one that is already reachable.
function keyConflict(name) {
  return getEntityKeyMap().get(normalizeKey(String(name ?? '').trim())) ?? null;
}

function getIgnoredSet() {
  return new Set(db.prepare('SELECT normalized FROM ignored_tokens').all().map((r) => r.normalized));
}

const insertMentionStmt = db.prepare(
  `INSERT INTO mentions (entity_id, chapter_id, revision_id, start_off, end_off, surface_text, context_sentence)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

// Gun scanning prepares these once, not once per chapter in a long scan.
const deletePendingGunCandidates = db.prepare(
  "DELETE FROM gun_candidates WHERE chapter_id = ? AND status = 'pending'"
);
const insertGunCandidate = db.prepare(
  `INSERT INTO gun_candidates (chapter_id, title, normalized, excerpt, score, signals, tier)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const gunCandidateExists = db.prepare('SELECT 1 FROM gun_candidates WHERE chapter_id = ? AND normalized = ?');
const upsertGunScan = db.prepare(
  `INSERT INTO gun_scans (chapter_id, scanned_at) VALUES (?, datetime('now'))
   ON CONFLICT(chapter_id) DO UPDATE SET scanned_at = datetime('now')`
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

// Accept and merge touch every chapter an entity appears in. Loading the tracked
// list, each entity's chapter orders and the dead list once per batch keeps a
// protagonist present in 2000 chapters from doing that work 2000 times.
function generateAlertsFor(chapterIds) {
  const chapterStmt = db.prepare('SELECT * FROM chapters WHERE id = ?');
  const chapters = [];
  const seen = new Set();
  for (const chapterId of chapterIds) {
    if (seen.has(chapterId)) continue;
    seen.add(chapterId);
    const chapter = chapterStmt.get(chapterId);
    if (chapter) chapters.push(chapter);
  }
  if (!chapters.length) return;

  const tracked = db
    .prepare("SELECT id, name, tracking, gap_threshold, fields FROM entities WHERE tracking IN ('reappearance','absence')")
    .all();
  const ordersById = new Map();
  for (const row of db
    .prepare(
      `SELECT DISTINCT m.entity_id, c.sort_order AS o
       FROM mentions m JOIN chapters c ON c.id = m.chapter_id
       JOIN entities e ON e.id = m.entity_id
       WHERE e.tracking IN ('reappearance','absence')
       ORDER BY m.entity_id, c.sort_order`
    )
    .all()) {
    const orders = ordersById.get(row.entity_id);
    if (orders) orders.push(row.o);
    else ordersById.set(row.entity_id, [row.o]);
  }
  const deadById = new Map(tracked.map((ent) => [ent.id, deathChapterFor(ent) !== null]));

  const resolveDormant = db.prepare(
    "UPDATE alerts SET state = 'resolved' WHERE entity_id = ? AND kind = 'dormant' AND state != 'resolved'"
  );
  const findReappeared = db.prepare(
    "SELECT id FROM alerts WHERE entity_id = ? AND kind = 'reappeared' AND chapter_id = ? AND state != 'resolved'"
  );
  const insertReappeared = db.prepare(
    "INSERT INTO alerts (entity_id, kind, chapter_id, detail) VALUES (?, 'reappeared', ?, ?)"
  );
  const findDormant = db.prepare(
    "SELECT id FROM alerts WHERE entity_id = ? AND kind = 'dormant' AND state != 'resolved'"
  );
  const updateDormant = db.prepare('UPDATE alerts SET detail = ?, chapter_id = ? WHERE id = ?');
  const insertDormant = db.prepare(
    "INSERT INTO alerts (entity_id, kind, chapter_id, detail) VALUES (?, 'dormant', ?, ?)"
  );

  for (const chapter of chapters) {
    for (const ent of tracked) {
      const dead = deadById.get(ent.id);
      const orders = ordersById.get(ent.id) ?? [];
      const at = lowerBound(orders, chapter.sort_order);
      const here = orders[at] === chapter.sort_order;
      const threshold = ent.gap_threshold ?? 0;

      if (here) resolveDormant.run(ent.id);

      if (ent.tracking === 'reappearance' && here && threshold > 0 && !dead) {
        if (at > 0) {
          const gap = countChaptersBetween(orders[at - 1], chapter.sort_order);
          if (gap >= threshold && !findReappeared.get(ent.id, chapter.id)) {
            insertReappeared.run(ent.id, chapter.id, `returns after ${gap} chapter${gap === 1 ? '' : 's'}`);
          }
        }
      }

      if (ent.tracking === 'absence' && !here && threshold > 0 && !dead) {
        const upto = upperBound(orders, chapter.sort_order);
        if (upto > 0) {
          const gap = countChaptersBetween(orders[upto - 1], chapter.sort_order, true);
          if (gap >= threshold) {
            const detail = `no appearance for ${gap} chapter${gap === 1 ? '' : 's'}`;
            const existing = findDormant.get(ent.id);
            if (existing) updateDormant.run(detail, chapter.id, existing.id);
            else insertDormant.run(ent.id, chapter.id, detail);
          }
        }
      }
    }
  }

  // Dead characters: mentions after their death chapter become posthumous alerts.
  // refreshPosthumous reads every mention itself, so once per entity is enough.
  const dead = db
    .prepare(
      `SELECT e.id FROM entities e
       WHERE e.trashed_at IS NULL AND e.fields LIKE '%"death"%'
         AND e.type_id IN (SELECT id FROM types WHERE name = 'Character')`
    )
    .all();
  for (const ent of dead) refreshPosthumous(ent.id);
}

function generateAlerts(chapterId) {
  generateAlertsFor([chapterId]);
}

function lowerBound(values, value) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(values, value) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// An entity only needs its chapters re-checked when it has a rule that can raise
// an alert. The common accept path defaults to tracking off and no death marker.
function needsAlertRefresh(entity) {
  if (entity.tracking !== 'off') return true;
  const death = parseEntityFields(entity.fields).death;
  return !!(death && typeof death === 'object' && !Array.isArray(death) && Number.isFinite(Number(death.chapter)));
}

// Keep the current revision plus a short tail. Old revision rows cascade their
// mentions and candidates; runScan has already re-linked this chapter to the new
// revision, so deleting the old rows only drops history, not the live scan.
function pruneChapterHistory(chapterId) {
  db.prepare(
    `DELETE FROM revisions
      WHERE chapter_id = ?
        AND id NOT IN (SELECT id FROM revisions WHERE chapter_id = ? ORDER BY id DESC LIMIT 10)`
  ).run(chapterId, chapterId);
  db.prepare(
    `DELETE FROM scans
      WHERE chapter_id = ?
        AND id NOT IN (SELECT id FROM scans WHERE chapter_id = ? ORDER BY id DESC LIMIT 10)`
  ).run(chapterId, chapterId);
  db.prepare(
    `DELETE FROM alerts
      WHERE chapter_id = ? AND state = 'resolved'
        AND id NOT IN (
          SELECT id FROM alerts WHERE chapter_id = ? AND state = 'resolved' ORDER BY id DESC LIMIT 10
        )`
  ).run(chapterId, chapterId);
}

function runScan(chapterId, revisionId, text) {
  const known = getEntityKeyMap();
  const lookalikeIndex = buildLookalikeIndex(known);
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
    const possible = findLookalike(c.key, known, lookalikeIndex);
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
  maybeAutoScanGuns(chapterId, text);
  pruneChapterHistory(chapterId);

  return { found: candidates.length, linked };
}

// Option C: a card that loses its last mention (e.g. its only chapter was
// deleted) is moved to Trash rather than destroyed, so notes are recoverable.
// Only cards that actually lost a mention in the deleted chapter can become
// orphans. A hand-made card with no mentions at all is not trash.
function sweepOrphans(entityIds) {
  const mentioned = db.prepare('SELECT 1 FROM mentions WHERE entity_id = ? LIMIT 1');
  const trash = db.prepare("UPDATE entities SET trashed_at = datetime('now') WHERE id = ? AND trashed_at IS NULL");
  let trashed = 0;
  for (const id of new Set(entityIds)) {
    if (mentioned.get(id)) continue;
    trashed += trash.run(id).changes ?? 0;
  }
  return trashed;
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

function gunScanOptions() {
  const entities = db
    .prepare(
      `SELECT e.id, e.name, t.name AS typeName
       FROM entities e LEFT JOIN types t ON t.id = e.type_id
       WHERE e.trashed_at IS NULL`
    )
    .all()
    .map((e) => ({ ...e, aliases: [] }));
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const a of db.prepare('SELECT entity_id, alias FROM aliases').all()) {
    byId.get(a.entity_id)?.aliases.push(a.alias);
  }
  return {
    entities,
    excluded: [
      ...db.prepare('SELECT normalized FROM gun_ignored').all().map((r) => r.normalized),
      ...db
        .prepare("SELECT normalized FROM gun_candidates WHERE status = 'accepted'")
        .all()
        .map((r) => r.normalized),
    ],
    existingGuns: db.prepare('SELECT title FROM guns').all().map((r) => r.title),
  };
}

function scanGunChapter(chapterId, options = null) {
  const chapter = chapterRow(chapterId);
  if (!chapter) return { found: 0, created: 0, skipped: 0 };
  const found = detectGunCandidates(chapterText(chapterId), options ?? gunScanOptions());
  deletePendingGunCandidates.run(chapterId);
  let created = 0;
  for (const c of found) {
    if (gunCandidateExists.get(chapterId, c.normalized)) continue;
    insertGunCandidate.run(chapterId, c.title, c.normalized, c.excerpt, c.score, JSON.stringify(c.signals), c.tier);
    created += 1;
  }
  upsertGunScan.run(chapterId);
  return { found: found.length, created, skipped: found.length - created };
}

// Automatic scan is a one-shot: the first non-empty save of a chapter, never a
// later revision. A failure must not take the chapter save down with it.
function maybeAutoScanGuns(chapterId, text) {
  if (!String(text ?? '').trim()) return;
  if (db.prepare('SELECT 1 FROM gun_scans WHERE chapter_id = ?').get(chapterId)) return;
  try {
    scanGunChapter(chapterId);
  } catch (err) {
    console.error('[gunscan] automatic scan failed:', err);
  }
}

function chapterMentions(id) {
  // A deferred save can leave the previous revision's mentions behind until the
  // scan runs; only the current revision may paint underlines in the reader.
  return db
    .prepare(
      `SELECT m.id, m.entity_id, m.start_off, m.end_off, m.surface_text,
              e.name, t.color AS type_color, t.name AS type_name
       FROM mentions m
       JOIN chapters c ON c.id = m.chapter_id
       JOIN entities e ON e.id = m.entity_id
       LEFT JOIN types t ON t.id = e.type_id
       WHERE m.chapter_id = ? AND m.revision_id = c.current_revision_id
         AND e.trashed_at IS NULL
       ORDER BY m.start_off`
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
  // Same order the duel engine uses for rank positions: sort_order, then id.
  // Ties are rare (sort_order is MAX+1 on create), but the ladder and the engine
  // must never disagree about which level is above which.
  res.json(db.prepare('SELECT * FROM power_levels ORDER BY sort_order, id').all());
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
  const rows = db.prepare('SELECT * FROM chapters ORDER BY sort_order').all();
  const mentions = new Map(
    db.prepare('SELECT chapter_id, COUNT(*) AS n FROM mentions GROUP BY chapter_id').all().map((r) => [r.chapter_id, r.n])
  );
  const candidates = new Map(
    db
      .prepare("SELECT chapter_id, COUNT(*) AS n FROM candidates WHERE status IN ('pending','later') GROUP BY chapter_id")
      .all()
      .map((r) => [r.chapter_id, r.n])
  );
  for (const row of rows) {
    row.mention_count = mentions.get(row.id) ?? 0;
    row.candidate_count = candidates.get(row.id) ?? 0;
  }
  res.json(rows);
});

app.post('/api/chapters', (req, res) => {
  const { number = '', title = '', text = '', afterChapterId = null } = req.body ?? {};
  let order;
  if (afterChapterId == null || afterChapterId === '') {
    const max = db.prepare('SELECT MAX(sort_order) AS m FROM chapters').get().m;
    order = (max ?? -1) + 1;
  } else {
    const after = db.prepare('SELECT sort_order FROM chapters WHERE id = ?').get(Number(afterChapterId));
    if (!after) return res.status(400).json({ error: 'after chapter not found' });
    order = after.sort_order + 1;
    db.prepare('UPDATE chapters SET sort_order = sort_order + 1 WHERE sort_order >= ?').run(order);
  }
  const info = db
    .prepare("INSERT INTO chapters (number, title, sort_order, word_count, updated_at) VALUES (?, ?, ?, ?, datetime('now'))")
    .run(String(number), String(title), order, wordCount(text));
  const chapterId = Number(info.lastInsertRowid);

  const rev = db.prepare('INSERT INTO revisions (chapter_id, text) VALUES (?, ?)').run(chapterId, text);
  const revisionId = Number(rev.lastInsertRowid);
  db.prepare('UPDATE chapters SET current_revision_id = ? WHERE id = ?').run(revisionId, chapterId);

  const scan = runScan(chapterId, revisionId, text);
  reconcileGuns();
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
         AND revision_id = (SELECT current_revision_id FROM chapters WHERE id = ?)
       ORDER BY confidence DESC`
    )
    .all(id, id)
    .map((c) => {
      // The reader only underlines mention spans; the id is enough for triage to
      // fetch the full contexts from /api/candidates/:id.
      let positions = '[]';
      try {
        positions = JSON.stringify(
          JSON.parse(c.positions || '[]').map((p) => ({ start: p.start, end: p.end }))
        );
      } catch {
        /* corrupt positions just leave no underline */
      }
      return { ...c, positions };
    });
  res.json({ chapter, text: chapterText(id), mentions: chapterMentions(id), candidates });
});

app.put('/api/chapters/:id', (req, res) => {
  const id = Number(req.params.id);
  const chapter = chapterRow(id);
  if (!chapter) return res.status(404).json({ error: 'not found' });
  const { text, number, title } = req.body ?? {};
  const deferScan = req.query.scan === '0' || req.query.scan === 'false';
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
    if (deferScan) {
      // The text is durable now. Clear the old revision's derived rows so Review
      // cannot show stale names while the client starts the scan.
      db.prepare('DELETE FROM mentions WHERE chapter_id = ?').run(id);
      db.prepare("DELETE FROM candidates WHERE chapter_id = ? AND status IN ('pending','later')").run(id);
      return res.json({ chapter: chapterRow(id), scan: null, scan_pending: true });
    }
    scan = runScan(id, revisionId, text);
  }
  reconcileGuns();
  res.json({ chapter: chapterRow(id), scan });
});

app.post('/api/chapters/:id/scan', (req, res) => {
  const id = Number(req.params.id);
  const chapter = chapterRow(id);
  if (!chapter) return res.status(404).json({ error: 'not found' });
  if (!chapter.current_revision_id) return res.json({ chapter, scan: null });
  const scan = runScan(id, chapter.current_revision_id, chapterText(id));
  res.json({ chapter: chapterRow(id), scan });
});

app.delete('/api/chapters/:id', (req, res) => {
  const id = Number(req.params.id);
  const chapter = chapterRow(id);
  if (!chapter) return res.status(404).json({ error: 'not found' });
  const renumber = req.query.renumber === '1' || req.query.renumber === 'true';
  // Collect before the delete: the mentions cascade with the chapter.
  const affected = db
    .prepare('SELECT DISTINCT entity_id FROM mentions WHERE chapter_id = ?')
    .all(id)
    .map((row) => row.entity_id);

  db.prepare('DELETE FROM chapters WHERE id = ?').run(id);

  if (renumber) {
    const rest = db.prepare('SELECT id, number, sort_order FROM chapters ORDER BY sort_order').all();
    const upd = db.prepare('UPDATE chapters SET sort_order = ?, number = ? WHERE id = ?');
    rest.forEach((c, i) => {
      const num = /^\d+$/.test(c.number) ? String(i + 1) : c.number;
      upd.run(i, num, c.id);
    });
  }
  const trashed = sweepOrphans(affected);
  reconcileGuns();
  res.json({ ok: true, trashed });
});

const REVIEW_TIER = (tier) =>
  (tier === 'demoted' ? "COALESCE(k.tier,'primary') = 'demoted'" : "COALESCE(k.tier,'primary') != 'demoted'");

// Review lists stay bounded: the reader only ever sees a few hundred at a time,
// and the full positions/contexts are fetched when a row is opened for triage.
// One short context is kept so the collapsed row still shows where it came from.
function reviewPendingRows(tier, limit, offset) {
  return db
    .prepare(
      `SELECT k.id, k.chapter_id, k.revision_id, k.surface_text, k.normalized, k.occurrences,
              k.suggested_type_id, k.confidence, k.signals, k.possible_entity_id, k.entity_id,
              k.tier, k.status, c.number AS chapter_number, c.title AS chapter_title,
              t.name AS type_name, t.color AS type_color, pe.name AS possible_name,
              CASE WHEN json_valid(k.contexts) THEN json_extract(k.contexts, '$[0]') END AS first_context
       FROM candidates k
       JOIN chapters c ON c.id = k.chapter_id
       LEFT JOIN types t ON t.id = k.suggested_type_id
       LEFT JOIN entities pe ON pe.id = k.possible_entity_id
       WHERE k.status IN ('pending','later') AND ${REVIEW_TIER(tier)}
       ORDER BY k.confidence DESC, k.occurrences DESC, k.id
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset)
    .map(({ first_context, ...row }) => ({
      ...row,
      contexts: JSON.stringify(first_context == null ? [] : [first_context]),
    }));
}

const reviewPendingTotal = () => {
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN COALESCE(tier,'primary') = 'demoted' THEN 1 ELSE 0 END), 0) AS demoted_n,
        COALESCE(SUM(CASE WHEN COALESCE(tier,'primary') != 'demoted' THEN 1 ELSE 0 END), 0) AS primary_n
       FROM candidates WHERE status IN ('pending','later')`
    )
    .get();
  return { primary: row.primary_n, demoted: row.demoted_n };
};

app.get('/api/review', (_req, res) => {
  const limit = 100;
  const totals = reviewPendingTotal();
  const pending = [...reviewPendingRows('primary', limit, 0), ...reviewPendingRows('demoted', limit, 0)].sort(
    (a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences || a.id - b.id
  );

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

  res.json({
    pending,
    alerts,
    pendingTotals: totals,
    pendingHasMore: {
      primary: pending.filter((c) => c.tier !== 'demoted').length < totals.primary,
      demoted: pending.filter((c) => c.tier === 'demoted').length < totals.demoted,
    },
  });
});

app.get('/api/review/pending', (req, res) => {
  const tier = req.query.tier === 'demoted' ? 'demoted' : 'primary';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 100) || 100));
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const total = reviewPendingTotal()[tier];
  const pending = reviewPendingRows(tier, limit, offset);
  res.json({ pending, total, hasMore: offset + pending.length < total });
});

app.get('/api/candidates/:id', (req, res) => {
  const id = Number(req.params.id);
  const candidate = db
    .prepare(
      `SELECT k.*, c.number AS chapter_number, c.title AS chapter_title,
              t.name AS type_name, t.color AS type_color, pe.name AS possible_name
       FROM candidates k
       JOIN chapters c ON c.id = k.chapter_id
       LEFT JOIN types t ON t.id = k.suggested_type_id
       LEFT JOIN entities pe ON pe.id = k.possible_entity_id
       WHERE k.id = ?`
    )
    .get(id);
  if (!candidate) return res.status(404).json({ error: 'not found' });
  res.json(candidate);
});

// The two triage actions Review batches, defined once so both routes share them.
// Ignoring a name ignores every pending spelling of it, as the single-row
// action does.
const deferCandidate = (candidate) =>
  db.prepare("UPDATE candidates SET status = 'later' WHERE id = ?").run(candidate.id);
const ignoreCandidate = (candidate) => {
  db.prepare('INSERT OR IGNORE INTO ignored_tokens (normalized) VALUES (?)').run(candidate.normalized);
  db.prepare("UPDATE candidates SET status = 'ignored' WHERE normalized = ? AND status IN ('pending','later')").run(candidate.normalized);
};

// Bulk triage from Review's selection bar: one request — and so one transaction
// and one refresh — instead of a full round trip per selected name.
app.post('/api/candidates/resolve', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  const { action } = req.body ?? {};
  if (ids.length === 0) return res.status(400).json({ error: 'ids required' });
  if (action !== 'later' && action !== 'ignore') {
    return res.status(400).json({ error: 'bulk triage supports ignore and later only' });
  }
  let count = 0;
  for (const id of ids) {
    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
    if (!candidate) continue;
    if (action === 'later') deferCandidate(candidate);
    else ignoreCandidate(candidate);
    count += 1;
  }
  res.json({ ok: true, count });
});

app.post('/api/candidates/:id/resolve', (req, res) => {
  const id = Number(req.params.id);
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
  if (!candidate) return res.status(404).json({ error: 'not found' });
  const { action, typeId, name, tracking = 'off', gapThreshold = null } = req.body ?? {};

  if (action === 'later') {
    deferCandidate(candidate);
    return res.json({ ok: true });
  }

  if (action === 'ignore') {
    ignoreCandidate(candidate);
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
    if (needsAlertRefresh(target)) {
      generateAlertsFor(
        db
          .prepare('SELECT DISTINCT chapter_id FROM mentions WHERE entity_id = ?')
          .all(targetId)
          .map((row) => row.chapter_id)
      );
    }
    return res.json({ ok: true, entityId: targetId });
  }

  if (action === 'accept') {
    const entityName = (name || candidate.surface_text).trim();
    const existingId = keyConflict(entityName);
    if (existingId != null) {
      return res.status(409).json({ error: `name already in use: ${entityName}`, entityId: existingId });
    }
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

    if (tracking !== 'off') {
      generateAlertsFor(
        db
          .prepare('SELECT DISTINCT chapter_id FROM mentions WHERE entity_id = ?')
          .all(entityId)
          .map((row) => row.chapter_id)
      );
    }
    return res.json({ ok: true, entityId });
  }

  res.status(400).json({ error: 'unknown action' });
});

// List payloads drop the base64 portrait (often hundreds of KB per card) and
// report only whether one exists; the image route serves the bytes on demand.
const ENTITY_FIELDS_SQL = `
  CASE WHEN json_valid(e.fields) THEN json_remove(e.fields, '$.image') ELSE e.fields END AS fields,
  CASE WHEN json_valid(e.fields)
    THEN (CASE WHEN json_type(e.fields, '$.image') = 'text' AND length(json_extract(e.fields, '$.image')) > 0
      THEN 1 ELSE 0 END)
    ELSE 0 END AS has_image`;

// One grouped mention pass instead of three correlated subqueries per card.
function attachMentionSpans(rows) {
  const spans = new Map(
    db
      .prepare(
        `SELECT m.entity_id, COUNT(*) AS n, MIN(c.sort_order) AS lo, MAX(c.sort_order) AS hi
         FROM mentions m JOIN chapters c ON c.id = m.chapter_id
         GROUP BY m.entity_id`
      )
      .all()
      .map((r) => [r.entity_id, r])
  );
  const numbers = new Map(db.prepare('SELECT sort_order, number FROM chapters').all().map((c) => [c.sort_order, c.number]));
  for (const row of rows) {
    const span = spans.get(row.id);
    row.mention_count = span?.n ?? 0;
    row.first_chapter = span ? numbers.get(span.lo) ?? null : null;
    row.last_chapter = span ? numbers.get(span.hi) ?? null : null;
  }
  return rows;
}

app.get('/api/entities', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.type_id, e.summary, ${ENTITY_FIELDS_SQL}, e.tracking, e.gap_threshold,
              e.trashed_at, e.created_at, e.updated_at,
              t.name AS type_name, t.color AS type_color, t.icon AS type_icon
       FROM entities e LEFT JOIN types t ON t.id = e.type_id
       WHERE e.trashed_at IS NULL
       ORDER BY t.sort_order, e.name COLLATE NOCASE`
    )
    .all();
  res.json(attachMentionSpans(rows));
});

app.get('/api/entities/:id/image', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT fields FROM entities WHERE id = ?').get(id);
  if (!row) return res.status(404).end();
  const image = parseEntityFields(row.fields).image;
  if (typeof image !== 'string' || !image) return res.status(404).end();
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(image);
  if (!match) {
    // Legacy rows may hold a remote URL; anything else has no bytes to serve.
    if (/^https?:\/\//i.test(image)) return res.redirect(image);
    return res.status(404).end();
  }
  const mime = match[1].toLowerCase();
  if (!mime.startsWith('image/')) return res.status(404).end();
  const bytes = match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'binary');
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'private, no-cache');
  res.send(bytes);
});

app.post('/api/entities', (req, res) => {
  const { name, typeId, tracking = 'off', gapThreshold = null, summary = '' } = req.body ?? {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  const existingId = keyConflict(name);
  if (existingId != null) {
    return res.status(409).json({ error: `name already in use: ${String(name).trim()}`, entityId: existingId });
  }
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

// ---------- Explicit relationships ----------
// source --label--> target. Both ends are shown on either card; the arrow tells
// the reader which way the label runs. Nothing is inferred from mentions.

function relationshipRowsFor(entityId) {
  return db
    .prepare(
      `SELECT r.*,
              s.name AS source_name, s.trashed_at AS source_trashed_at,
              st.icon AS source_type_icon,
              t.name AS target_name, t.trashed_at AS target_trashed_at,
              tt.icon AS target_type_icon
       FROM relationships r
       JOIN entities s ON s.id = r.source_id
       JOIN entities t ON t.id = r.target_id
       LEFT JOIN types st ON st.id = s.type_id
       LEFT JOIN types tt ON tt.id = t.type_id
       WHERE r.source_id = ? OR r.target_id = ?
       ORDER BY CASE WHEN r.source_id = ? THEN 0 ELSE 1 END, r.label, s.name, t.name`
    )
    .all(entityId, entityId, entityId);
}

function readRelationshipInput(body, current = null) {
  const sourceId = current ? current.source_id : Number(body?.sourceId);
  const targetId = current ? current.target_id : Number(body?.targetId);
  const label = body?.label !== undefined ? String(body.label).trim() : current?.label ?? '';
  if (!Number.isInteger(sourceId) || sourceId <= 0 || !Number.isInteger(targetId) || targetId <= 0) {
    return { error: 'sourceId and targetId are required' };
  }
  if (sourceId === targetId) return { error: 'a card cannot relate to itself' };
  if (!label) return { error: 'label required' };
  // A new edge may only join live cards; an existing edge can still be relabelled
  // if one of its cards was later moved to Trash.
  if (!current) {
    const live = db.prepare('SELECT 1 FROM entities WHERE id = ? AND trashed_at IS NULL');
    if (!live.get(sourceId) || !live.get(targetId)) return { error: 'entity not found' };
  }
  return {
    sourceId,
    targetId,
    label,
    notes: body?.notes !== undefined ? String(body.notes) : current?.notes ?? '',
  };
}

function duplicateRelationshipId(sourceId, targetId, label, exceptId = 0) {
  return db
    .prepare('SELECT id FROM relationships WHERE source_id = ? AND target_id = ? AND label = ? AND id != ?')
    .get(sourceId, targetId, label, exceptId)?.id;
}

function mergeRelationships(survivorId, absorbedId) {
  const rows = db
    .prepare('SELECT id, source_id, target_id, label FROM relationships WHERE source_id = ? OR target_id = ?')
    .all(absorbedId, absorbedId);
  const remove = db.prepare('DELETE FROM relationships WHERE id = ?');
  const update = db.prepare(
    "UPDATE relationships SET source_id = ?, target_id = ?, updated_at = datetime('now') WHERE id = ?"
  );
  for (const row of rows) {
    const sourceId = row.source_id === absorbedId ? survivorId : row.source_id;
    const targetId = row.target_id === absorbedId ? survivorId : row.target_id;
    // A↔B becomes A↔A: drop it. If A already has the same edge to the other end,
    // keep that one and drop the absorbed duplicate.
    if (sourceId === targetId || duplicateRelationshipId(sourceId, targetId, row.label, row.id)) {
      remove.run(row.id);
    } else {
      update.run(sourceId, targetId, row.id);
    }
  }
}

// Timeline links use (event, entity, role) as their key, so a merge must drop
// an absorbed duplicate before repointing the rest.
function mergeTimelineEntityLinks(survivorId, absorbedId) {
  db.prepare(
    `DELETE FROM timeline_event_entities
     WHERE entity_id = ?
       AND EXISTS (
         SELECT 1 FROM timeline_event_entities keep
         WHERE keep.entity_id = ? AND keep.event_id = timeline_event_entities.event_id
           AND keep.role = timeline_event_entities.role
       )`
  ).run(absorbedId, survivorId);
  db.prepare('UPDATE timeline_event_entities SET entity_id = ? WHERE entity_id = ?').run(survivorId, absorbedId);
}

// Read-only overview: every explicit edge, including edges whose card is in
// Trash, so the list can explain a missing end instead of silently losing it.
app.get('/api/relationships', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT r.*,
                s.name AS source_name, s.trashed_at AS source_trashed_at,
                st.icon AS source_type_icon,
                t.name AS target_name, t.trashed_at AS target_trashed_at,
                tt.icon AS target_type_icon
         FROM relationships r
         JOIN entities s ON s.id = r.source_id
         JOIN entities t ON t.id = r.target_id
         LEFT JOIN types st ON st.id = s.type_id
         LEFT JOIN types tt ON tt.id = t.type_id
         ORDER BY r.label, s.name, t.name`
      )
      .all()
  );
});

app.get('/api/entities/:id/relationships', (req, res) => {
  res.json(relationshipRowsFor(Number(req.params.id)));
});app.post('/api/relationships', (req, res) => {
  const input = readRelationshipInput(req.body ?? {});
  if (input.error) return res.status(400).json({ error: input.error });
  const duplicate = duplicateRelationshipId(input.sourceId, input.targetId, input.label);
  if (duplicate) return res.status(409).json({ error: 'relationship already exists', id: duplicate });
  const info = db
    .prepare('INSERT INTO relationships (source_id, target_id, label, notes) VALUES (?, ?, ?, ?)')
    .run(input.sourceId, input.targetId, input.label, input.notes);
  res.json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/relationships/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM relationships WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'not found' });
  const input = readRelationshipInput(req.body ?? {}, current);
  if (input.error) return res.status(400).json({ error: input.error });
  const duplicate = duplicateRelationshipId(input.sourceId, input.targetId, input.label, id);
  if (duplicate) return res.status(409).json({ error: 'relationship already exists', id: duplicate });
  db.prepare(
    "UPDATE relationships SET label = ?, notes = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(input.label, input.notes, id);
  res.json({ ok: true });
});

app.delete('/api/relationships/:id', (req, res) => {
  db.prepare('DELETE FROM relationships WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Read-only suggestions: sentences in this chapter that state a time outright.
// Nothing is written; the author still opens the editor and saves.
app.get('/api/chapters/:id/event-candidates', (req, res) => {
  const id = Number(req.params.id);
  const chapter = chapterRow(id);
  if (!chapter) return res.status(404).json({ error: 'not found' });
  const existing = new Set(
    db
      .prepare('SELECT title FROM timeline_events WHERE chapter_id = ?')
      .all(id)
      .map((row) => String(row.title).trim().toLowerCase())
  );
  const candidates = extractEventCandidates(chapterText(id))
    .filter((candidate) => !existing.has(candidate.title.toLowerCase()))
    .map((candidate) => ({ ...candidate, chapter_id: id }));
  res.json(candidates);
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

  const mergedFields = JSON.stringify(mergeFields(a.fields, b.fields));
  db.prepare(
    `UPDATE entities SET summary = ?, type_id = ?, fields = ?, tracking = ?, gap_threshold = ?,
       updated_at = datetime('now') WHERE id = ?`
  ).run(
    (a.summary || '').trim() ? a.summary : b.summary,
    a.type_id ?? b.type_id,
    mergedFields,
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
  if (needsAlertRefresh({ tracking, fields: mergedFields })) {
    generateAlertsFor(
      db.prepare('SELECT DISTINCT chapter_id FROM mentions WHERE entity_id = ?').all(id).map((row) => row.chapter_id)
    );
  }
  refreshPosthumous(id);

  // 5. Cross-references: anything B owned (an item may have several holders) now
  //    belongs to A; Organisation relations pointing at B (leader / members /
  //    operates_in) now point at A.
  const setFields = db.prepare("UPDATE entities SET fields = ?, updated_at = datetime('now') WHERE id = ?");
  let ownersRepointed = 0;
  for (const row of db.prepare('SELECT id, fields FROM entities').all()) {
    const repointed = repointReferences(parseEntityFields(row.fields), {
      survivorId: id,
      absorbedId,
      selfId: row.id,
    });
    ownersRepointed += repointed.ownersRepointed;
    if (repointed.touched) setFields.run(JSON.stringify(repointed.fields), row.id);
  }
  mergeRelationships(id, absorbedId);
  mergeTimelineEntityLinks(id, absorbedId);

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
      `SELECT e.id, e.name, e.type_id, e.summary, ${ENTITY_FIELDS_SQL}, e.tracking, e.gap_threshold,
              e.trashed_at, e.created_at, e.updated_at,
              t.name AS type_name, t.color AS type_color, t.icon AS type_icon
       FROM entities e LEFT JOIN types t ON t.id = e.type_id
       WHERE e.trashed_at IS NOT NULL ORDER BY e.trashed_at DESC`
    )
    .all();
  res.json(attachMentionSpans(rows));
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

app.get('/api/guns/candidates', (req, res) => {
  const status = String(req.query.status ?? 'pending');
  const rows = db
    .prepare(
      `SELECT k.*, c.number AS chapter_number, c.title AS chapter_title
       FROM gun_candidates k JOIN chapters c ON c.id = k.chapter_id
       WHERE k.status = ?
       ORDER BY c.sort_order, CASE k.tier WHEN 'primary' THEN 0 ELSE 1 END, k.score DESC, k.id`
    )
    .all(status);
  res.json(rows);
});

app.get('/api/guns/review', (_req, res) => {
  const pending = db.prepare("SELECT COUNT(*) AS n FROM gun_candidates WHERE status = 'pending'").get().n;
  const later = db.prepare("SELECT value FROM meta WHERE key = 'gun_review_later_on'").get()?.value ?? '';
  const today = todayLocal();
  res.json({ pending, today, due: pending > 0 && later !== today });
});

app.post('/api/guns/review/later', (_req, res) => {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('gun_review_later_on', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(todayLocal());
  res.json({ ok: true, due: false });
});

app.post('/api/guns/scan', (req, res) => {
  const ids = Array.isArray(req.body?.chapterIds) ? req.body.chapterIds.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'chapterIds required' });
  let created = 0;
  let skipped = 0;
  const chapters = [];
  // One options load for the whole request: entities, aliases, ignored names and
  // existing guns do not change while the scan runs.
  const options = gunScanOptions();
  for (const chapterId of ids) {
    if (!chapterRow(chapterId)) continue;
    const scan = scanGunChapter(chapterId, options);
    created += scan.created;
    skipped += scan.skipped;
    chapters.push({ chapterId, ...scan });
  }
  res.json({ created, skipped, chapters });
});

app.post('/api/guns/candidates/:id/resolve', (req, res) => {
  const id = Number(req.params.id);
  const cand = db.prepare('SELECT * FROM gun_candidates WHERE id = ?').get(id);
  if (!cand) return res.status(404).json({ error: 'not found' });
  if (cand.status !== 'pending') return res.status(409).json({ error: 'already resolved' });
  const action = String(req.body?.action ?? '');

  if (action === 'reject') {
    db.prepare('INSERT OR IGNORE INTO gun_ignored (normalized) VALUES (?)').run(cand.normalized);
    db.prepare("UPDATE gun_candidates SET status = 'rejected' WHERE normalized = ? AND status = 'pending'").run(
      cand.normalized
    );
    return res.json({ ok: true });
  }

  if (action === 'accept') {
    const title = String(req.body?.title ?? cand.title).trim();
    if (!title) return res.status(400).json({ error: 'title required' });
    const appearanceChapterId =
      req.body?.chapterId !== undefined ? req.body.chapterId ?? null : cand.chapter_id;
    const info = db
      .prepare(
        `INSERT INTO guns (title, explanation, impact, appearance_chapter_id, planned_number, updated_at)
         VALUES (?, '', '', ?, '', datetime('now'))`
      )
      .run(title, appearanceChapterId);
    const gunId = Number(info.lastInsertRowid);
    db.prepare("UPDATE gun_candidates SET status = 'accepted', gun_id = ? WHERE id = ?").run(gunId, id);
    return res.json({ ok: true, gunId });
  }

  res.status(400).json({ error: 'action must be "accept" or "reject"' });
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

// ---------- Duels ----------
//
// A duel is written once and never recomputed. The route loads every name, rank
// and role from the book, so a client can only choose who fights, which of their
// stored abilities/Items they bring, and the terrain. The snapshot is stored with
// no foreign keys, so a fighter can be deleted or merged later without breaking
// the record.

const MAX_DUEL_TERRAIN = 80;

function parseDuel(row) {
  return {
    id: row.id,
    title: row.title,
    sides: JSON.parse(row.sides),
    outcome: JSON.parse(row.outcome),
    narrative: row.narrative,
    created_at: row.created_at,
  };
}

/** One order for the Duels tab and the export: newest first, id as the tie-break. */
function allDuels() {
  return db.prepare('SELECT * FROM duels ORDER BY created_at DESC, id DESC').all().map(parseDuel);
}

function badDuel(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function readDuelSides(body) {
  const raw = body?.sides;
  if (!Array.isArray(raw) || raw.length !== 2) throw badDuel('sides must be exactly two');
  return raw.map((side, index) => {
    const label = index === 0 ? 'A' : 'B';
    if (!side || !Array.isArray(side.fighters)) throw badDuel(`side ${label} needs a fighters array`);
    if (side.fighters.length < 1 || side.fighters.length > MAX_FIGHTERS_PER_SIDE) {
      throw badDuel(`each side needs 1 to ${MAX_FIGHTERS_PER_SIDE} fighters`);
    }
    return side.fighters;
  });
}

app.get('/api/duels', (_req, res) => {
  res.json(allDuels());
});

app.post('/api/duels', (req, res) => {
  try {
    const [rawA, rawB] = readDuelSides(req.body ?? {});
    const chosenWinner = req.body?.chosenWinner ?? null;
    const skilledSide = req.body?.skilledSide ?? null;
    if (chosenWinner != null && chosenWinner !== 'A' && chosenWinner !== 'B') {
      throw badDuel('chosenWinner must be "A", "B" or null');
    }
    if (skilledSide != null && skilledSide !== 'A' && skilledSide !== 'B') {
      throw badDuel('skilledSide must be "A", "B" or null');
    }
    const terrain = String(req.body?.terrain ?? '').trim();
    if (terrain.length > MAX_DUEL_TERRAIN) {
      throw badDuel(`terrain must be ${MAX_DUEL_TERRAIN} characters or fewer`);
    }

    const characters = db
      .prepare(
        `SELECT e.id, e.name, e.fields, e.trashed_at, t.name AS type_name
         FROM entities e LEFT JOIN types t ON t.id = e.type_id`
      )
      .all();
    const characterById = new Map(characters.map((c) => [Number(c.id), c]));
    const items = db
      .prepare(
        `SELECT e.id, e.name, e.fields, e.trashed_at
         FROM entities e JOIN types t ON t.id = e.type_id WHERE t.name = 'Item'`
      )
      .all();
    const itemById = new Map(items.map((i) => [Number(i.id), i]));
    const powerLevels = db.prepare('SELECT id, sort_order FROM power_levels ORDER BY sort_order, id').all();

    const seenCharacters = new Set();
    const itemSide = new Map();
    const picks = { A: [], B: [] };
    const selectedItems = new Map(); // characterId -> Set(item id)

    for (const [side, list] of [
      ['A', rawA],
      ['B', rawB],
    ]) {
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') throw badDuel('each fighter needs a characterId');
        const characterId = Number(raw.characterId);
        const character = characterById.get(characterId);
        if (!character || character.trashed_at) {
          throw badDuel(`character ${raw.characterId} is missing or in Trash`);
        }
        if (character.type_name !== 'Character') {
          throw badDuel(`${character.name} is not a Character`);
        }
        if (seenCharacters.has(characterId)) {
          throw badDuel(`${character.name} cannot appear twice in one duel`);
        }
        seenCharacters.add(characterId);

        const fields = parseEntityFields(character.fields);
        const pool = Array.isArray(fields.abilities) ? fields.abilities : [];
        const poolIds = new Set(
          pool.filter((ability) => ability && typeof ability === 'object').map((ability) => String(ability.id))
        );
        const abilityIds = raw.abilityIds ?? [];
        if (!Array.isArray(abilityIds)) throw badDuel(`abilityIds for ${character.name} must be an array`);
        if (abilityIds.length > 3) throw badDuel(`${character.name} can use at most 3 abilities`);
        for (const id of abilityIds) {
          if (!poolIds.has(String(id))) {
            throw badDuel(`ability ${id} does not belong to ${character.name}`);
          }
        }

        const itemIds = raw.itemIds ?? [];
        if (!Array.isArray(itemIds)) throw badDuel(`itemIds for ${character.name} must be an array`);
        const chosenItems = new Set();
        for (const rawItemId of itemIds) {
          const itemId = Number(rawItemId);
          const item = itemById.get(itemId);
          if (!item || item.trashed_at) throw badDuel(`item ${rawItemId} is missing or in Trash`);
          const itemFields = parseEntityFields(item.fields);
          const owners = Array.isArray(itemFields.owners) ? itemFields.owners.map(Number) : [];
          if (!owners.includes(characterId)) throw badDuel(`${character.name} does not hold ${item.name}`);
          const otherSide = itemSide.get(itemId);
          if (otherSide && otherSide !== side) throw badDuel(`${item.name} cannot be used on both sides`);
          itemSide.set(itemId, side);
          chosenItems.add(itemId);
        }
        selectedItems.set(characterId, chosenItems);
        picks[side].push({ characterId, abilityIds: abilityIds.map(String) });
      }
    }

    const snapshot = snapshotCombatants({
      sides: picks,
      characters: characters.map((c) => ({ id: c.id, name: c.name, fields: parseEntityFields(c.fields) })),
      items: items.map((i) => ({ id: i.id, name: i.name, fields: parseEntityFields(i.fields) })),
      powerLevels,
    });
    for (const side of ['A', 'B']) {
      snapshot[side] = snapshot[side].map((fighter) => ({
        ...fighter,
        items: fighter.items.filter((item) => selectedItems.get(fighter.characterId)?.has(Number(item.id))),
      }));
    }

    const seed = randomInt(0, 4294967296);
    const result = resolveDuel({
      sides: snapshot,
      seed,
      chosenWinner,
      skilledSide: chosenWinner ? null : skilledSide,
      terrain,
    });

    const breakdown = (side) => ({
      ...result.scorecard[side],
      fighters: result.scorecard[side].fighters.map((part, index) => ({
        name: snapshot[side][index]?.name ?? 'the fighter',
        ...part,
      })),
    });
    const outcome = {
      ...result.outcome,
      roll: result.roll,
      probabilityA: result.probabilityA,
      breakdown: { A: breakdown('A'), B: breakdown('B') },
    };
    const sides = { terrain, A: snapshot.A, B: snapshot.B };
    const names = (list) => list.map((fighter) => fighter.name).join(' + ');
    const title = String(req.body?.title ?? '').trim() || `${names(snapshot.A)} vs ${names(snapshot.B)}`;

    const info = db
      .prepare('INSERT INTO duels (title, sides, outcome, narrative) VALUES (?, ?, ?, ?)')
      .run(title, JSON.stringify(sides), JSON.stringify(outcome), result.narrative);
    res.json(parseDuel(db.prepare('SELECT * FROM duels WHERE id = ?').get(Number(info.lastInsertRowid))));
  } catch (e) {
    if (e?.status === 400) return res.status(400).json({ error: e.message });
    throw e;
  }
});

app.delete('/api/duels/:id', (req, res) => {
  const info = db.prepare('DELETE FROM duels WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'not found' });
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

// ---------- Story timeline ----------
//
// Events are explicitly written by the author. A chapter is only the manuscript
// anchor; story_order is the chronology, so a flashback can sit before the
// chapter it appears in, and a planned event can have no chapter at all.

const TIMELINE_KINDS = new Set(['event', 'birth', 'death', 'battle', 'reveal', 'travel', 'other']);
const TIMELINE_ROLES = new Set(['participant', 'location', 'item']);

function allTimelineEvents() {
  const rows = db
    .prepare(
      `SELECT e.*, c.number AS chapter_number, c.title AS chapter_title
       FROM timeline_events e
       LEFT JOIN chapters c ON c.id = e.chapter_id
       ORDER BY e.story_order, e.id`
    )
    .all();
  const links = db
    .prepare(
      `SELECT l.event_id, l.entity_id, l.role, en.name, en.trashed_at,
              t.name AS type_name, t.color AS type_color
       FROM timeline_event_entities l
       JOIN entities en ON en.id = l.entity_id
       LEFT JOIN types t ON t.id = en.type_id
       ORDER BY l.event_id, l.role, en.name`
    )
    .all();
  const byId = new Map(rows.map((row) => [row.id, { ...row, entities: [] }]));
  for (const link of links) {
    byId.get(link.event_id)?.entities.push({
      entity_id: link.entity_id,
      role: link.role,
      name: link.name,
      trashed_at: link.trashed_at,
      type_name: link.type_name,
      type_color: link.type_color,
    });
  }
  return rows.map((row) => byId.get(row.id));
}

function readTimelineInput(body, current = null) {
  const title = body.title !== undefined ? String(body.title).trim() : current?.title ?? '';
  if (!title) return { error: 'title required' };

  let chapterId = current?.chapter_id ?? null;
  if (body.chapterId !== undefined) {
    if (body.chapterId === null || body.chapterId === '') {
      chapterId = null;
    } else {
      chapterId = Number(body.chapterId);
      if (!Number.isInteger(chapterId) || !chapterRow(chapterId)) {
        return { error: 'chapter not found' };
      }
    }
  }

  const kind = body.kind !== undefined ? String(body.kind) : current?.kind ?? 'event';
  if (!TIMELINE_KINDS.has(kind)) return { error: 'invalid kind' };

  let storyDay = current?.story_day ?? null;
  if (body.storyDay !== undefined) {
    if (body.storyDay === null || body.storyDay === '') {
      storyDay = null;
    } else {
      storyDay = Number(body.storyDay);
      if (!Number.isInteger(storyDay) || storyDay < 0) {
        return { error: 'storyDay must be a whole number of days' };
      }
    }
  }

  let storyOrder = current?.story_order ?? null;
  if (body.storyOrder !== undefined) {
    storyOrder = Number(body.storyOrder);
    if (!Number.isInteger(storyOrder)) return { error: 'storyOrder must be an integer' };
  }
  if (storyOrder == null) {
    const max = db.prepare('SELECT COALESCE(MAX(story_order), -1) AS n FROM timeline_events').get().n;
    storyOrder = max + 1;
  }

  let links = null;
  if (body.entities !== undefined) {
    if (!Array.isArray(body.entities)) return { error: 'entities must be an array' };
    links = [];
    const seen = new Set();
    const live = db.prepare('SELECT 1 FROM entities WHERE id = ? AND trashed_at IS NULL');
    for (const raw of body.entities) {
      const entityId = Number(raw?.entityId ?? raw?.id);
      if (!Number.isInteger(entityId) || entityId <= 0) return { error: 'invalid entity' };
      const role = String(raw?.role ?? 'participant');
      if (!TIMELINE_ROLES.has(role)) return { error: 'invalid role' };
      if (!live.get(entityId)) return { error: `entity not found: ${entityId}` };
      const key = `${entityId}:${role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ entityId, role });
    }
  }

  return {
    title,
    summary: body.summary !== undefined ? String(body.summary) : current?.summary ?? '',
    chapterId,
    storyTime: body.storyTime !== undefined ? String(body.storyTime) : current?.story_time ?? '',
    storyDay,
    storyOrder,
    kind,
    links,
  };
}

function replaceTimelineLinks(eventId, links) {
  db.prepare('DELETE FROM timeline_event_entities WHERE event_id = ?').run(eventId);
  const insert = db.prepare(
    'INSERT INTO timeline_event_entities (event_id, entity_id, role) VALUES (?, ?, ?)'
  );
  for (const link of links) insert.run(eventId, link.entityId, link.role);
}

app.get('/api/timeline/events', (_req, res) => {
  res.json(allTimelineEvents());
});

app.post('/api/timeline/events', (req, res) => {
  const input = readTimelineInput(req.body ?? {});
  if (input.error) return res.status(400).json({ error: input.error });
  const info = db
    .prepare(
      `INSERT INTO timeline_events (title, summary, chapter_id, story_time, story_day, story_order, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.title,
      input.summary,
      input.chapterId,
      input.storyTime,
      input.storyDay,
      input.storyOrder,
      input.kind
    );
  const id = Number(info.lastInsertRowid);
  replaceTimelineLinks(id, input.links ?? []);
  res.json({ id });
});

// Reorder takes the complete, ordered id list. The client sends it after a
// move; one transaction assigns consecutive story_order values.
app.put('/api/timeline/events/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  const existing = db.prepare('SELECT id FROM timeline_events ORDER BY story_order, id').all().map((row) => row.id);
  if (ids.length === 0 && existing.length === 0) return res.json({ ok: true });
  if (
    ids.length === 0 ||
    ids.some((id) => !Number.isInteger(id) || id <= 0) ||
    new Set(ids).size !== ids.length ||
    ids.length !== existing.length ||
    existing.some((id) => !ids.includes(id))
  ) {
    return res.status(400).json({ error: 'ids must list every event exactly once' });
  }
  const setOrder = db.prepare('UPDATE timeline_events SET story_order = ? WHERE id = ?');
  ids.forEach((id, index) => setOrder.run(index, id));
  res.json({ ok: true });
});

app.put('/api/timeline/events/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'not found' });
  const input = readTimelineInput(req.body ?? {}, current);
  if (input.error) return res.status(400).json({ error: input.error });
  db.prepare(
    `UPDATE timeline_events
     SET title = ?, summary = ?, chapter_id = ?, story_time = ?, story_day = ?, story_order = ?, kind = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    input.title,
    input.summary,
    input.chapterId,
    input.storyTime,
    input.storyDay,
    input.storyOrder,
    input.kind,
    id
  );
  if (input.links) replaceTimelineLinks(id, input.links);
  res.json({ ok: true });
});

app.delete('/api/timeline/events/:id', (req, res) => {
  db.prepare('DELETE FROM timeline_events WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- static (production build, if present) ----------

const dist = join(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

// The book's folder, as tracked by the desktop app's menu. Empty unless the app
// has written one — this is a read-only view of it.
app.get('/api/projects', (_req, res) => {
  try {
    const regPath = join(homedir(), '.config', 'docwriter', 'projects.json');
    res.json(existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : []);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// A consistent, WAL-collapsed copy of the book. Copying the .db on its own would
// silently drop everything still sitting in the -wal file — which is where recent
// writes live, so that copy would be missing the writer's latest work. VACUUM
// INTO produces one self-contained, checkpointed file.
app.get('/api/backup', (_req, res) => {
  const target = join(tmpdir(), `docwriter-backup-${process.pid}-${Date.now()}.db`);
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
  res.set('Content-Disposition', 'attachment; filename="docwriter-backup.db"');
  res.set('Content-Type', 'application/octet-stream');
  // sendFile streams the snapshot instead of loading a whole second copy into
  // memory. The temp file is removed once the transfer settles.
  res.sendFile(target, (err) => {
    rmSync(target, { force: true });
    if (err && !res.headersSent) res.status(500).json({ error: String(err) });
  });
});

// ---------- Markdown export ----------
//
// The whole book as one text file: every chapter's current revision, every live
// entity, every gun and every question. Images stay out (a .md is text), and so
// does anything the writer threw away — Trash and the Review queue are working
// state, not the book. Entity ids are resolved to names here, so the file stands
// on its own with no database to look anything up in.

// Mirrors the Organisation editor in EntityPanel: these three types share the
// leader · members · operates in · purpose · accomplishments fields.
const ORG_TYPES = ['Organisation', 'Location', 'Country'];

const META_KEYS = ['export_nudge', 'last_export_at', 'last_nudged_on', 'last_chapter'];

function metaRows() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM meta').all()) out[row.key] = row.value;
  return out;
}

function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// What the reminder needs: the saved frequency, both dates, and whether the
// period has run out. "Today" is the server's local day — the same machine.
function metaState() {
  const rows = metaRows();
  const nudge = rows.export_nudge || 'daily';
  const lastExportAt = rows.last_export_at || null;
  const lastNudgedOn = rows.last_nudged_on || null;
  const today = todayLocal();
  // Nothing written yet is nothing to export, so a brand-new book does not open
  // with a nag. The period itself starts with the writer's first chapter.
  const hasWork = db.prepare('SELECT COUNT(*) AS n FROM chapters').get().n > 0;
  const lastChapter = /^\d+$/.test(rows.last_chapter ?? '') ? Number(rows.last_chapter) : null;
  return {
    nudge,
    lastExportAt,
    lastNudgedOn,
    today,
    last_chapter: lastChapter,
    due: hasWork && isNudgeDue({ nudge, lastExportAt, lastNudgedOn, today }),
  };
}

// `distinct_feature` -> `Distinct feature`: exactly the labels the editor shows,
// derived from the key so the two lists cannot drift apart.
function humanize(key) {
  const words = String(key).replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The fixed plus custom rows of a Character System / History bag, as bullets. */
function bagItems(bag) {
  const src = bag && typeof bag === 'object' && !Array.isArray(bag) ? bag : {};
  const items = [];
  for (const [key, value] of Object.entries(src)) {
    if (key === 'custom') continue;
    if (String(value ?? '').trim() === '') continue;
    items.push({ name: humanize(key), body: value });
  }
  for (const entry of Array.isArray(src.custom) ? src.custom : []) {
    items.push({ name: entry?.name, body: entry?.body });
  }
  return items;
}

/** `{ id, name, body }` rows (abilities, accomplishments) as bullets. */
function entryItems(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({ name: row?.name, body: row?.body }));
}

function exportEntities(nameById, chapterNumberById, levelById) {
  const rows = attachMentionSpans(
    db
      .prepare(
        `SELECT e.id, e.name, e.type_id, e.summary, ${ENTITY_FIELDS_SQL}, e.tracking, e.gap_threshold,
                e.trashed_at, e.created_at, e.updated_at,
                t.name AS type_name
         FROM entities e LEFT JOIN types t ON t.id = e.type_id
         WHERE e.trashed_at IS NULL
         ORDER BY t.sort_order, e.name COLLATE NOCASE`
      )
      .all()
  );

  const aliases = new Map();
  for (const row of db.prepare('SELECT entity_id, alias FROM aliases ORDER BY id').all()) {
    if (!aliases.has(row.entity_id)) aliases.set(row.entity_id, []);
    aliases.get(row.entity_id).push(row.alias);
  }

  const nameOf = (id) => nameById.get(Number(id)) ?? 'Missing entity';
  const memberIds = (v) =>
    (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isFinite(n) && nameById.has(n));

  const groups = [];
  for (const e of rows) {
    const fields = parseEntityFields(e.fields);
    const type = e.type_name ?? 'Unsorted';
    let group = groups[groups.length - 1];
    if (!group || group.typeName !== type) {
      group = { typeName: type, cards: [] };
      groups.push(group);
    }

    const lines = [];
    const aliasList = aliases.get(e.id) ?? [];
    if (aliasList.length) lines.push(`Aliases: ${aliasList.join(', ')}`);
    if (e.mention_count) {
      const span =
        e.first_chapter === e.last_chapter
          ? `Ch ${e.first_chapter}`
          : `Ch ${e.first_chapter}–Ch ${e.last_chapter}`;
      lines.push(`Mentions: ${e.mention_count} · ${span}`);
    }

    const sections = [];
    const summary = String(e.summary ?? '').trim();
    if (type === 'Character') {
      const level = levelById.get(Number(fields.power_level));
      if (level) lines.push(`Power level: ${level}`);
      const death = fields.death && typeof fields.death === 'object' ? fields.death : null;
      const diedIn = death ? chapterNumberById.get(Number(death.chapter)) : null;
      if (diedIn) lines.push(`Died in Ch ${diedIn}`);
      if (summary) sections.push({ heading: 'Summary', body: summary });
      sections.push({ heading: 'System', items: bagItems(fields.system) });
      sections.push({ heading: 'Abilities', items: entryItems(fields.abilities) });
      sections.push({ heading: 'History', items: bagItems(fields.history) });
    } else if (type === 'Item') {
      if (String(fields.rank ?? '').trim()) lines.push(`Rank: ${fields.rank}`);
      const role = String(fields.role ?? '').trim();
      if (role) lines.push(`Role: ${role[0].toUpperCase()}${role.slice(1)}`);
      if (fields.evolvable === true) lines.push('Evolvable: yes');
      const owners = memberIds(fields.owners);
      if (owners.length) lines.push(`Held by: ${owners.map(nameOf).join(', ')}`);
      if (summary) sections.push({ heading: 'Origin', body: summary });
      sections.push({ heading: 'Description', body: fields.description });
      sections.push({ heading: 'Boon', body: fields.boon });
      sections.push({ heading: 'Curse', body: fields.curse });
    } else if (ORG_TYPES.includes(type)) {
      if (nameById.has(Number(fields.leader))) lines.push(`Leader: ${nameOf(fields.leader)}`);
      const members = memberIds(fields.members);
      if (members.length) lines.push(`Members: ${members.map(nameOf).join(', ')}`);
      if (nameById.has(Number(fields.operates_in))) lines.push(`Operates in: ${nameOf(fields.operates_in)}`);
      if (summary) sections.push({ heading: 'Origin', body: summary });
      sections.push({ heading: 'Description', body: fields.description });
      sections.push({ heading: 'Purpose', body: fields.purpose });
      sections.push({ heading: 'Accomplishments', items: entryItems(fields.accomplishments) });
    } else if (summary) {
      sections.push({ heading: 'Summary', body: summary });
    }

    group.cards.push({ name: e.name, lines, sections });
  }
  return groups;
}

function exportGuns(chapterById) {
  return allGunsWithState().map((gun) => {
    const lines = [`Status: ${gun.status === 'fired' ? 'fired' : 'active'}`];
    const appears = chapterById.get(Number(gun.appearance_chapter_id));
    if (appears) lines.push(`Appears: ${chapterLabel(appears)}`);
    const planned = chapterById.get(Number(gun.planned_chapter_id));
    if (planned) lines.push(`Planned payoff: ${chapterLabel(planned)}`);
    else if (String(gun.planned_number ?? '').trim()) lines.push(`Planned payoff: Ch ${gun.planned_number}`);
    if (String(gun.impact ?? '').trim()) lines.push(`Impact: ${gun.impact}`);

    const history = db
      .prepare('SELECT * FROM gun_history WHERE gun_id = ? ORDER BY id')
      .all(gun.id)
      .map((h) => ({
        name: humanize(h.decision),
        body: [h.chapter_label, h.from_number && h.to_number ? `moved to Ch ${h.to_number}` : '']
          .filter(Boolean)
          .join(' · '),
      }));

    return {
      name: gun.title,
      lines,
      sections: [
        { heading: 'Explanation', body: gun.explanation },
        { heading: 'Outcome', body: gun.outcome },
        { heading: 'History', items: history },
      ],
    };
  });
}

function exportQuestions(chapterById) {
  const label = (id) => {
    const chapter = chapterById.get(Number(id));
    return chapter ? chapterLabel(chapter) : '';
  };
  return allQuestions().map((q) => ({
    status: questionStatus(q),
    text: q.text,
    source: label(q.source_chapter_id),
    delivered: label(q.delivered_chapter_id),
    answer: q.answer,
  }));
}

app.get('/api/export', (_req, res) => {
  try {
    const chapterById = new Map(chapterList().map((c) => [c.id, c]));
    const chapterNumberById = new Map(chapterList().map((c) => [c.id, effectiveNumber(c)]));
    // Trashed cards are excluded from the export but still named here, so a
    // surviving reference to one reads as a name rather than a bare number.
    const nameById = new Map(db.prepare('SELECT id, name FROM entities').all().map((e) => [e.id, e.name]));
    const levelById = new Map(db.prepare('SELECT id, name FROM power_levels').all().map((l) => [l.id, l.name]));

    const doc = {
      exportedAt: todayLocal(),
      chapters: db
        .prepare(
          `SELECT c.number, c.title, c.word_count AS wordCount, r.text
           FROM chapters c LEFT JOIN revisions r ON r.id = c.current_revision_id
           ORDER BY c.sort_order`
        )
        .all(),
      groups: exportEntities(nameById, chapterNumberById, levelById),
      guns: exportGuns(chapterById),
      questions: exportQuestions(chapterById),
      duels: allDuels(),
      powerLevels: db.prepare('SELECT name FROM power_levels ORDER BY sort_order, name').all().map((l) => l.name),
      types: db.prepare('SELECT name FROM types ORDER BY sort_order, name').all().map((t) => t.name),
    };

    res.set('Content-Disposition', `attachment; filename="docwriter-export-${todayLocal()}.md"`);
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    // One write per chapter (and per card), so a long book never has to become
    // one giant string in memory.
    let first = true;
    for (const chunk of renderBookMarkdownChunks(doc)) {
      res.write((first ? '' : '\n') + chunk.join('\n'));
      first = false;
    }
    res.end('\n');
  } catch (e) {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

// ---------- export reminder state ----------
// Frequency plus the dates of the last export and the last dismissal. Stored in
// the book, not localStorage: the packaged app serves each run from a fresh port,
// so its origin — and its storage — resets on every launch.

app.get('/api/meta', (_req, res) => {
  res.json(metaState());
});

app.put('/api/meta', (req, res) => {
  const body = req.body ?? {};
  // Validate the whole patch before writing: this request runs in a transaction,
  // and a 4xx still commits, so a half-applied patch would otherwise stick.
  const patch = [];
  for (const [key, raw] of Object.entries(body)) {
    if (!META_KEYS.includes(key)) return res.status(400).json({ error: `unknown key: ${key}` });
    const value = raw == null ? '' : String(raw);
    if (key === 'export_nudge' && !NUDGE_FREQUENCIES.includes(value)) {
      return res.status(400).json({ error: `bad reminder frequency: ${value}` });
    }
    if (key === 'last_chapter' && value !== '' && !/^\d+$/.test(value)) {
      return res.status(400).json({ error: `bad chapter id for ${key}: ${value}` });
    }
    if (key !== 'export_nudge' && key !== 'last_chapter' && value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return res.status(400).json({ error: `bad date for ${key}: ${value}` });
    }
    patch.push([key, value]);
  }
  const upsert = db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [key, value] of patch) upsert.run(key, value);
  res.json(metaState());
});

const PORT = Number(process.env.PORT ?? 5178);
// Loopback by default: this API has no authentication, so it must not be
// reachable from the network. The desktop app passes 127.0.0.1 as well.
const HOST = process.env.HOST || '127.0.0.1';
const onListen = function () {
  console.log(`[server] listening on http://${HOST}:${this.address().port}`);
};
app.listen(PORT, HOST, onListen);
