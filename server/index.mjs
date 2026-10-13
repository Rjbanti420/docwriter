import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { db, migrate } from './db.mjs';
import { detect, normalizeKey, findLookalike } from './detect.mjs';

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

function generateAlerts(chapterId) {
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
  if (!chapter) return;
  const tracked = db
    .prepare("SELECT id, name, tracking, gap_threshold FROM entities WHERE tracking IN ('reappearance','absence')")
    .all();

  for (const ent of tracked) {
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

    if (ent.tracking === 'reappearance' && here && threshold > 0) {
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

    if (ent.tracking === 'absence' && !here && threshold > 0) {
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
       WHERE m.chapter_id = ? ORDER BY m.start_off`
    )
    .all(id);
}

// ---------- routes ----------

app.get('/api/types', (_req, res) => {
  res.json(db.prepare('SELECT * FROM types ORDER BY sort_order, name').all());
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
      `SELECT a.*, e.name AS entity_name, t.color AS type_color, c.number AS chapter_number
       FROM alerts a
       JOIN entities e ON e.id = a.entity_id
       LEFT JOIN types t ON t.id = e.type_id
       LEFT JOIN chapters c ON c.id = a.chapter_id
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
  res.json({ ok: true });
});

app.delete('/api/entities/:id', (req, res) => {
  db.prepare('DELETE FROM entities WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
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

// ---------- static (production build, if present) ----------

const dist = join(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.get('/api/projects', (_req,res)=>{ try{ const regPath=join(app.getPath('userData'),'projects.json'); let list=[]; if(existsSync(regPath)){ list=JSON.parse(readFileSync(regPath,'utf8')); } res.json(list);}catch(e){res.status(500).json({error:String(e)});} });
app.post('/api/projects/switch', (req,res)=>{ try{ const p=req.body?.path; if(!p) return res.status(400).json({error:'path required'}); writeSettings({dbPath:p}); res.json({ok:true}); }catch(e){res.status(500).json({error:String(e)});} });
const PORT = Number(process.env.PORT ?? 5178);
const HOST = process.env.HOST || undefined;
const onListen = () => console.log(`[server] listening on http://${HOST || 'localhost'}:${PORT}`);
if (HOST) app.listen(PORT, HOST, onListen);
else app.listen(PORT, onListen);
