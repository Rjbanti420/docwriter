import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupBook, backupsDir, listBackups } from './backup.mjs';

function book(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docwriter-backup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'book.db');
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec('CREATE TABLE chapters (id INTEGER PRIMARY KEY, title TEXT)');
  return { dir, path, db };
}

test('an empty book is not worth a snapshot', (t) => {
  const { path, db } = book(t);
  assert.equal(backupBook(db, path), null);
  assert.equal(listBackups(path).length, 0);
});

test('the snapshot is a whole database, and one is enough per day', (t) => {
  const { path, db } = book(t);
  db.exec("INSERT INTO chapters (title) VALUES ('The Grey Harbour')");
  const now = new Date(2026, 10, 18, 9, 0, 0);

  const first = backupBook(db, path, { now });
  assert.equal(first.name, 'book-2026-11-18.db');
  assert.equal(backupsDir(path), join(path, '..', 'backups'));

  // The copy is a real book, not an empty file.
  const copy = new DatabaseSync(first.path);
  t.after(() => copy.close());
  assert.deepEqual(copy.prepare('SELECT title FROM chapters').get().title, 'The Grey Harbour');

  // A second run on the same day must not vacuum again or make a second file.
  const second = backupBook(db, path, { now: new Date(2026, 10, 18, 22, 0, 0) });
  assert.equal(second.path, first.path);
  assert.equal(readdirSync(backupsDir(path)).length, 1);
});

test('two books in one folder keep separate snapshots', (t) => {
  const { path, db } = book(t);
  db.exec("INSERT INTO chapters (title) VALUES ('One')");
  const other = join(dirname(path), 'other.db');
  const otherDb = new DatabaseSync(other);
  t.after(() => otherDb.close());
  otherDb.exec('CREATE TABLE chapters (id INTEGER PRIMARY KEY, title TEXT)');
  otherDb.exec("INSERT INTO chapters (title) VALUES ('Two')");

  const now = new Date(2026, 10, 18);
  backupBook(db, path, { now });
  backupBook(otherDb, other, { now });

  assert.deepEqual(listBackups(path).map((b) => b.name), ['book-2026-11-18.db']);
  assert.deepEqual(listBackups(other).map((b) => b.name), ['other-2026-11-18.db']);
});

test('only the newest snapshots are kept', (t) => {
  const { path, db } = book(t);
  db.exec("INSERT INTO chapters (title) VALUES ('One')");
  const dir = backupsDir(path);
  mkdirSync(dir, { recursive: true });
  for (const day of ['2026-11-10', '2026-11-11', '2026-11-12']) {
    writeFileSync(join(dir, `book-${day}.db`), 'old');
  }

  backupBook(db, path, { now: new Date(2026, 10, 18), keep: 3 });
  assert.deepEqual(
    listBackups(path).map((b) => b.name),
    ['book-2026-11-18.db', 'book-2026-11-12.db', 'book-2026-11-11.db']
  );
});
