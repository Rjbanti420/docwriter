// Migration tests. Kept apart from the route tests because db.mjs opens the
// database named by DOCWRITER_DB at import time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('migrate is idempotent and adds duels without disturbing existing rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'docwriter-db-'));
  process.env.DOCWRITER_DB = join(dir, 'book.db');

  const { db, migrate } = await import('./db.mjs');
  migrate();
  migrate();

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  assert.ok(tables.includes('duels'));

  // Long-book indexes are part of the schema, so an existing book gains them on boot.
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
  for (const name of [
    'idx_mentions_entity_chapter',
    'idx_revisions_chapter',
    'idx_scans_chapter',
    'idx_alerts_entity',
    'idx_alerts_chapter',
    'idx_aliases_entity',
    'idx_timeline_order',
    'idx_timeline_chapter',
    'idx_timeline_links_entity',
    'idx_relationships_source',
    'idx_relationships_target',
  ]) {
    assert.ok(indexes.includes(name), `missing index ${name}`);
  }

  const columns = db.prepare('PRAGMA table_info(duels)').all().map((c) => c.name);
  assert.deepEqual(columns, ['id', 'title', 'sides', 'outcome', 'narrative', 'created_at']);

  db.prepare('INSERT INTO duels (title, sides, outcome, narrative) VALUES (?, ?, ?, ?)').run('t', '{}', '{}', 'n');
  migrate();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM duels').get().n, 1);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});
