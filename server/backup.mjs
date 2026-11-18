// One self-contained snapshot of the book per day, beside the book itself.
//
// The manual Export is a download the writer has to remember. This is the
// floor under it: if the .db is lost or corrupted, yesterday is still on disk.
// VACUUM INTO is the same trick /api/backup uses — a plain copy of the .db
// would drop everything still in the -wal file, which is where the day's
// writing lives.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

export function backupsDir(bookPath) {
  return join(dirname(bookPath), 'backups');
}

/** Snapshots are named for their book, so two books in one folder never share. */
function prefixOf(bookPath) {
  return `${basename(bookPath, extname(bookPath))}-`;
}

/** Local calendar day, so "today" matches the writer's day, not UTC's. */
function dayOf(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** This book's snapshots on disk, newest first. */
export function listBackups(bookPath) {
  const dir = backupsDir(bookPath);
  if (!existsSync(dir)) return [];
  const prefix = prefixOf(bookPath);
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}\.db$/.test(name.slice(prefix.length)))
    .sort()
    .reverse()
    .map((name) => {
      const path = join(dir, name);
      const st = statSync(path);
      return { name, path, size: st.size, mtime: st.mtime.toISOString() };
    });
}

/**
 * Takes today's snapshot unless one is already there. Returns the newest
 * snapshot after the call (whether or not this call wrote it), or null when
 * there is nothing worth backing up yet.
 */
export function backupBook(db, bookPath, { now = new Date(), keep = 5 } = {}) {
  const chapters = db.prepare('SELECT COUNT(*) AS n FROM chapters').get().n;
  if (!chapters) return null;

  const dir = backupsDir(bookPath);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${prefixOf(bookPath)}${dayOf(now)}.db`);

  // VACUUM INTO refuses an existing file. Today's snapshot is enough, so an
  // earlier run (or a half-written file from a crash) is simply left alone.
  if (!existsSync(target)) {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  }

  const kept = listBackups(bookPath);
  for (const old of kept.slice(keep)) rmSync(old.path, { force: true });
  return kept[0] ?? null;
}
