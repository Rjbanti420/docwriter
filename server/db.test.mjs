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

  const columns = db.prepare('PRAGMA table_info(duels)').all().map((c) => c.name);
  assert.deepEqual(columns, ['id', 'title', 'sides', 'outcome', 'narrative', 'created_at']);

  db.prepare('INSERT INTO duels (title, sides, outcome, narrative) VALUES (?, ?, ?, ?)').run('t', '{}', '{}', 'n');
  migrate();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM duels').get().n, 1);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});
