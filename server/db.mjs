import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');

// DOCWRITER_DB lets the desktop app and tests point at another database file.
const dbPath = process.env.DOCWRITER_DB || join(dataDir, 'docwriter.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT '',
  color TEXT DEFAULT '#888888',
  built_in INTEGER DEFAULT 0,
  detection_hints TEXT DEFAULT '[]',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY,
  number TEXT DEFAULT '',
  title TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  current_revision_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type_id INTEGER REFERENCES types(id),
  summary TEXT DEFAULT '',
  fields TEXT DEFAULT '{}',
  tracking TEXT DEFAULT 'off',
  gap_threshold INTEGER,
  trashed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aliases (
  id INTEGER PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  revision_id INTEGER REFERENCES revisions(id) ON DELETE CASCADE,
  start_off INTEGER,
  end_off INTEGER,
  surface_text TEXT DEFAULT '',
  context_sentence TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  revision_id INTEGER REFERENCES revisions(id) ON DELETE CASCADE,
  surface_text TEXT NOT NULL,
  normalized TEXT NOT NULL,
  occurrences INTEGER DEFAULT 1,
  positions TEXT DEFAULT '[]',
  contexts TEXT DEFAULT '[]',
  suggested_type_id INTEGER,
  confidence REAL DEFAULT 0,
  signals TEXT DEFAULT '[]',
  possible_entity_id INTEGER,
  entity_id INTEGER,
  tier TEXT DEFAULT 'primary',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ignored_tokens (
  id INTEGER PRIMARY KEY,
  normalized TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Small per-book key/value bag. Used for the export reminder (frequency and the
-- dates of the last export and the last dismissal). It lives here rather than in
-- the renderer because Chrome resets localStorage every launch: the packaged app
-- serves each run from a fresh free port, so the origin — and its storage — changes.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- Character power levels: a book-wide, user-defined rank ladder. Unlike the
-- fixed Item ranks, the writer invents these (Primor, Seeker, …). Assignments
-- live on the entity as fields.power_level (the level id), so renaming a level
-- updates every character that uses it.
CREATE TABLE IF NOT EXISTS power_levels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  detail TEXT DEFAULT '',
  state TEXT DEFAULT 'unread',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  revision_id INTEGER,
  found INTEGER DEFAULT 0,
  linked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mentions_entity ON mentions(entity_id);
CREATE INDEX IF NOT EXISTS idx_mentions_chapter ON mentions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_mentions_entity_chapter ON mentions(entity_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_candidates_chapter ON candidates(chapter_id);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_revisions_chapter ON revisions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_scans_chapter ON scans(chapter_id);
CREATE INDEX IF NOT EXISTS idx_alerts_state ON alerts(state);
CREATE INDEX IF NOT EXISTS idx_alerts_entity ON alerts(entity_id);
CREATE INDEX IF NOT EXISTS idx_alerts_chapter ON alerts(chapter_id);
CREATE INDEX IF NOT EXISTS idx_aliases_entity ON aliases(entity_id);

-- Chekhov's Guns: a planted detail and its planned payoff chapter.
-- Chapter links are id references (never the displayed number), so renumbering
-- a chapter cannot silently break a gun; a deleted chapter only nulls the link.
CREATE TABLE IF NOT EXISTS guns (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  explanation TEXT DEFAULT '',
  impact TEXT DEFAULT '',
  appearance_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  planned_number TEXT DEFAULT '',
  planned_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  outcome TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  fired_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gun_history (
  id INTEGER PRIMARY KEY,
  gun_id INTEGER NOT NULL REFERENCES guns(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  chapter_label TEXT DEFAULT '',
  decision TEXT NOT NULL,
  from_number TEXT DEFAULT '',
  to_number TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Duel records are immutable snapshots: names, abilities, Items, terrain and the
-- score breakdown are copied at creation, with no foreign keys to entities. A
-- deleted, trashed or merged fighter therefore cannot break an old duel.
CREATE TABLE IF NOT EXISTS duels (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  sides TEXT NOT NULL,
  outcome TEXT NOT NULL,
  narrative TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Questions the novel raises, so each one gets answered.
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  answer TEXT DEFAULT '',
  source_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  delivered_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  origin TEXT DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Scan results for questions, reviewed (accept/edit/reject) like entity candidates.
CREATE TABLE IF NOT EXISTS question_candidates (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  normalized TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Objects the gun scan found, waiting for the writer to add or ignore them.
-- Ignoring writes the normalized title to gun_ignored, so the same suggestion
-- never comes back in another chapter.
CREATE TABLE IF NOT EXISTS gun_candidates (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  normalized TEXT NOT NULL,
  excerpt TEXT DEFAULT '',
  score REAL DEFAULT 0,
  signals TEXT DEFAULT '[]',
  tier TEXT DEFAULT 'primary',
  status TEXT DEFAULT 'pending',
  gun_id INTEGER REFERENCES guns(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gun_ignored (
  id INTEGER PRIMARY KEY,
  normalized TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- One automatic gun scan per chapter. A row only exists after the first
-- non-empty save, so existing chapters stay untouched until the writer scans.
CREATE TABLE IF NOT EXISTS gun_scans (
  chapter_id INTEGER PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  scanned_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guns_status ON guns(status);
CREATE INDEX IF NOT EXISTS idx_guns_planned ON guns(planned_number);
CREATE INDEX IF NOT EXISTS idx_gun_history_gun ON gun_history(gun_id);
CREATE INDEX IF NOT EXISTS idx_questions_source ON questions(source_chapter_id);
CREATE INDEX IF NOT EXISTS idx_questions_delivered ON questions(delivered_chapter_id);
CREATE INDEX IF NOT EXISTS idx_qc_chapter ON question_candidates(chapter_id);
CREATE INDEX IF NOT EXISTS idx_qc_status ON question_candidates(status);
CREATE INDEX IF NOT EXISTS idx_gc_chapter ON gun_candidates(chapter_id);
CREATE INDEX IF NOT EXISTS idx_gc_status ON gun_candidates(status);
CREATE INDEX IF NOT EXISTS idx_gc_normalized ON gun_candidates(normalized);
`;

const BUILTIN_TYPES = [
  { name: 'Character', icon: '👤', color: '#d97706', hints: ['dialogue', 'frequency', 'name-list'] },
  { name: 'Country', icon: '🏳', color: '#059669', hints: ['kingdom', 'empire', 'republic', 'federation'] },
  { name: 'Organisation', icon: '🏛', color: '#7c3aed', hints: ['guild', 'order', 'council', 'company'] },
  { name: 'Location', icon: '📍', color: '#0284c7', hints: ['mount', 'river', 'city', 'vale'] },
  { name: 'Item', icon: '🗡', color: '#db2777', hints: [] },
];

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export function migrate() {
  db.exec(SCHEMA);
  // forward-compatible migrations for existing databases
  ensureColumn('entities', 'trashed_at', 'trashed_at TEXT');
  ensureColumn('candidates', 'tier', "tier TEXT DEFAULT 'primary'");
  // power levels gained a per-level colour after the ladder shipped.
  ensureColumn('power_levels', 'color', "color TEXT DEFAULT ''");
  // alerts stay entity-centric; gun notifications hang off a nullable gun_id.
  ensureColumn('alerts', 'gun_id', 'gun_id INTEGER');
  const count = db.prepare('SELECT COUNT(*) AS n FROM types').get().n;
  if (count === 0) {
    const insert = db.prepare(
      'INSERT INTO types (name, icon, color, built_in, detection_hints, sort_order) VALUES (?, ?, ?, 1, ?, ?)'
    );
    BUILTIN_TYPES.forEach((t, i) => insert.run(t.name, t.icon, t.color, JSON.stringify(t.hints), i));
  }
}
