// Route-level tests. The other files test the pure policy modules; these spawn the
// real server against a throwaway database (DOCWRITER_DB) and talk to it over HTTP,
// so they exercise the routes themselves — the layer where a missing import, an
// unopened transaction or a lost WAL actually bites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), 'docwriter-api-'));
  const child = spawn(process.execPath, [join(root, 'server', 'index.mjs')], {
    cwd: root,
    // HOME is redirected so the project registry path is deterministic and empty.
    env: { ...process.env, HOME: dir, DOCWRITER_DB: join(dir, 'book.db'), PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server never started:\n${log}`)), 20_000);
    child.stdout.on('data', (chunk) => {
      log += chunk;
      const m = log.match(/listening on (http:\/\/[\d.]+:\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.stderr.on('data', (chunk) => {
      log += chunk;
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited (${code}):\n${log}`));
    });
  });
  return {
    base,
    dir,
    stop: () => {
      child.kill();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

async function call(base, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  assert.ok(res.ok, `${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

test('the API listens on loopback only', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  assert.match(srv.base, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('GET /api/backup returns a whole, valid database', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', title: 'One', text: 'Kael drew the blade. Kael ran.' },
  });

  const res = await fetch(`${srv.base}/api/backup`);
  assert.equal(res.status, 200);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString('latin1'), 'SQLite format 3');

  // The backup is a snapshot taken through VACUUM INTO, so it must contain the
  // chapter that was just written. A plain copy of the .db file can miss exactly
  // this, because fresh writes may still be sitting in the -wal.
  const copy = join(srv.dir, 'copy.db');
  writeFileSync(copy, bytes);
  const check = new DatabaseSync(copy, { readOnly: true });
  const chapters = check.prepare('SELECT COUNT(*) AS n FROM chapters').get().n;
  const integrity = check.prepare('PRAGMA integrity_check').get().integrity_check;
  check.close();
  assert.equal(chapters, 1);
  assert.equal(integrity, 'ok');
});

test('GET /api/projects answers instead of throwing', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  assert.deepEqual(await call(srv.base, '/api/projects'), []);
});

test('merging repoints an item held by the absorbed entity', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const types = await call(srv.base, '/api/types');
  const itemType = types.find((x) => x.name === 'Item').id;

  const aria = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Aria' } });
  const arya = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Arya' } });
  const blade = await call(srv.base, '/api/entities', {
    method: 'POST',
    body: { name: 'The Blade', typeId: itemType },
  });

  await call(srv.base, `/api/entities/${blade.id}`, {
    method: 'PUT',
    body: { fields: { owners: [arya.id, aria.id] } },
  });

  const merged = await call(srv.base, `/api/entities/${aria.id}/merge`, {
    method: 'POST',
    body: { absorbedId: arya.id },
  });
  assert.equal(merged.ownersRepointed, 1);

  const item = await call(srv.base, `/api/entities/${blade.id}`);
  // Arya was folded into Aria, so [Arya, Aria] collapses to [Aria] — no duplicate.
  assert.deepEqual(JSON.parse(item.entity.fields).owners, [aria.id]);

  const live = await call(srv.base, '/api/entities');
  assert.ok(!live.some((e) => e.id === arya.id), 'the absorbed card is in Trash');
  const trash = await call(srv.base, '/api/trash');
  assert.ok(trash.some((e) => e.id === arya.id));
});

test('bulk triage resolves a whole selection in one request', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  // Two multi-word, non-dictionary names — the only kind the scanner rates primary.
  await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: {
      number: '1',
      title: 'One',
      text: 'The Silver Order marched east. The Silver Order halted. Grey Harbour burned.',
    },
  });

  const names = (await call(srv.base, '/api/review')).pending.filter((c) => c.tier !== 'demoted');
  assert.ok(names.length >= 2, `expected primary candidates, got ${JSON.stringify(names)}`);

  const deferred = names.slice(0, 1);
  const ignored = names.slice(1);
  const laterRes = await call(srv.base, '/api/candidates/resolve', {
    method: 'POST',
    body: { ids: deferred.map((c) => c.id), action: 'later' },
  });
  const ignoreRes = await call(srv.base, '/api/candidates/resolve', {
    method: 'POST',
    body: { ids: ignored.map((c) => c.id), action: 'ignore' },
  });
  assert.equal(laterRes.count, deferred.length);
  assert.equal(ignoreRes.count, ignored.length);

  const after = (await call(srv.base, '/api/review')).pending.map((c) => c.id);
  assert.ok(ignored.every((c) => !after.includes(c.id)), 'an ignored name leaves Review');
  const rejected = (await call(srv.base, '/api/ignored')).map((r) => r.normalized);
  assert.ok(ignored.every((c) => rejected.includes(c.normalized)), 'an ignored name is in Rejected');
  assert.ok(deferred.every((c) => after.includes(c.id)), 'a deferred name comes back later');
});

test('deleting a middle chapter with renumber closes the gap', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  for (const [number, title] of [['1', 'One'], ['2', 'Two'], ['3', 'Three']]) {
    await call(srv.base, '/api/chapters', { method: 'POST', body: { number, title, text: `${title}.` } });
  }

  const two = (await call(srv.base, '/api/chapters')).find((c) => c.number === '2');
  await call(srv.base, `/api/chapters/${two.id}?renumber=1`, { method: 'DELETE' });

  const chapters = await call(srv.base, '/api/chapters');
  assert.deepEqual(chapters.map((c) => c.number), ['1', '2']);
  assert.deepEqual(chapters.map((c) => c.title), ['One', 'Three']);
});

test('GET /api/export renders the whole book and leaves Trash out', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', title: 'Ash', text: 'Kael drew the blade.' },
  });

  const types = await call(srv.base, '/api/types');
  const characterType = types.find((x) => x.name === 'Character').id;
  const kael = await call(srv.base, '/api/entities', {
    method: 'POST',
    body: { name: 'Kael', typeId: characterType },
  });
  await call(srv.base, `/api/entities/${kael.id}`, {
    method: 'PUT',
    body: { fields: { history: { origin: 'A foundling.' } } },
  });

  const gone = await call(srv.base, '/api/entities', {
    method: 'POST',
    body: { name: 'Deleted One', typeId: characterType },
  });
  await call(srv.base, '/api/entities/trash', { method: 'POST', body: { ids: [gone.id] } });

  const res = await fetch(`${srv.base}/api/export`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  assert.match(
    res.headers.get('content-disposition'),
    /filename="docwriter-export-\d{4}-\d{2}-\d{2}\.md"/
  );
  const md = await res.text();

  assert.match(md, /^### 1\. Ash$/m);
  assert.ok(md.includes('Kael drew the blade.'), 'the chapter text is in the file');
  assert.match(md, /^#### Kael$/m);
  assert.match(md, /^- \*\*Origin\*\* — A foundling\.$/m);
  assert.ok(!md.includes('Deleted One'), 'a trashed card is not exported');
});

test('the export reminder starts due, then a date satisfies it', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const empty = await call(srv.base, '/api/meta');
  assert.equal(empty.due, false, 'a book with nothing in it is never nagged');

  await call(srv.base, '/api/chapters', { method: 'POST', body: { number: '1', title: 'One', text: 'Kael.' } });

  const fresh = await call(srv.base, '/api/meta');
  assert.equal(fresh.nudge, 'daily');
  assert.equal(fresh.due, true, 'a book that was never exported asks on first launch');

  const saved = await call(srv.base, '/api/meta', {
    method: 'PUT',
    body: { export_nudge: 'weekly', last_export_at: fresh.today },
  });
  assert.equal(saved.nudge, 'weekly');
  assert.equal(saved.lastExportAt, fresh.today);
  assert.equal(saved.due, false);

  const stale = await call(srv.base, '/api/meta', {
    method: 'PUT',
    body: { last_export_at: '2020-01-01' },
  });
  assert.equal(stale.due, true, 'a long-past export asks again');

  // A bad frequency or date must change nothing: a 4xx still commits the request
  // transaction, so the route has to validate the whole patch before writing.
  for (const body of [{ export_nudge: 'hourly' }, { last_export_at: 'yesterday' }, { nope: '1' }]) {
    const res = await fetch(`${srv.base}/api/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, `rejects ${JSON.stringify(body)}`);
  }
  const after = await call(srv.base, '/api/meta');
  assert.equal(after.nudge, 'weekly', 'the rejected patches left nothing behind');
});
