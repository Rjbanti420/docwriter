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
CREATE INDEX IF NOT EXISTS idx_candidates_chapter ON candidates(chapter_id);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_alerts_state ON alerts(state);
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
  const count = db.prepare('SELECT COUNT(*) AS n FROM types').get().n;
  if (count === 0) {
    const insert = db.prepare(
      'INSERT INTO types (name, icon, color, built_in, detection_hints, sort_order) VALUES (?, ?, ?, 1, ?, ?)'
    );
    BUILTIN_TYPES.forEach((t, i) => insert.run(t.name, t.icon, t.color, JSON.stringify(t.hints), i));
  }
}
