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

test('saving a chapter keeps only the newest history rows', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Kael' } });
  const created = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', title: 'One', text: 'Kael.' },
  });
  const id = created.chapter.id;
  for (let i = 1; i <= 12; i += 1) {
    await call(srv.base, `/api/chapters/${id}`, { method: 'PUT', body: { text: `Kael. version ${i}` } });
  }

  // Seed more resolved alerts than the cap, plus one that must survive because
  // it is still unread. The server is idle between requests.
  const live = new DatabaseSync(join(srv.dir, 'book.db'));
  const addAlert = live.prepare("INSERT INTO alerts (kind, chapter_id, state) VALUES ('test', ?, ?)");
  for (let i = 0; i < 12; i += 1) addAlert.run(id, 'resolved');
  addAlert.run(id, 'unread');
  live.close();

  await call(srv.base, `/api/chapters/${id}`, { method: 'PUT', body: { text: 'Kael. version 13' } });

  // Read the backup snapshot so the live WAL cannot hide the result.
  const res = await fetch(`${srv.base}/api/backup`);
  const copy = join(srv.dir, 'history.db');
  writeFileSync(copy, Buffer.from(await res.arrayBuffer()));
  const check = new DatabaseSync(copy, { readOnly: true });
  const revisions = check.prepare('SELECT id, text FROM revisions WHERE chapter_id = ? ORDER BY id').all(id);
  const scans = check.prepare('SELECT COUNT(*) AS n FROM scans WHERE chapter_id = ?').get(id).n;
  const resolved = check
    .prepare("SELECT COUNT(*) AS n FROM alerts WHERE chapter_id = ? AND state = 'resolved'")
    .get(id).n;
  const unread = check.prepare("SELECT COUNT(*) AS n FROM alerts WHERE chapter_id = ? AND state = 'unread'").get(id).n;
  const mentions = check.prepare('SELECT revision_id FROM mentions WHERE chapter_id = ?').all(id);
  const current = check.prepare('SELECT current_revision_id FROM chapters WHERE id = ?').get(id).current_revision_id;
  check.close();

  assert.equal(revisions.length, 10, 'the newest ten revisions are kept');
  assert.equal(revisions.at(-1)?.text, 'Kael. version 13');
  assert.equal(current, revisions.at(-1)?.id, 'the current revision is never pruned');
  assert.equal(scans, 10, 'the newest ten scans are kept');
  assert.equal(mentions.length, 1, 'the live mention survived the revision prune');
  assert.equal(mentions[0]?.revision_id, current, 'the mention points at the current revision');
  assert.equal(resolved, 10, 'the newest ten resolved alerts are kept');
  assert.equal(unread, 1, 'an unresolved alert is never pruned');
});

test('a deferred save keeps the text immediately and the scan route catches up', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const kael = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Kael' } });
  const created = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', title: 'One', text: 'Nobody moved.' },
  });
  const id = created.chapter.id;

  const saved = await call(srv.base, `/api/chapters/${id}?scan=0`, {
    method: 'PUT',
    body: { text: 'Kael waited.' },
  });
  assert.equal(saved.scan, null, 'the deferred save does not wait for a scan');
  assert.equal(saved.scan_pending, true);

  const immediate = await call(srv.base, `/api/chapters/${id}`);
  assert.equal(immediate.text, 'Kael waited.', 'the text is durable before the scan');
  assert.equal(immediate.mentions.length, 0, 'the previous revision does not paint stale underlines');

  const scanned = await call(srv.base, `/api/chapters/${id}/scan`, { method: 'POST' });
  assert.ok(scanned.scan, 'the follow-up scan ran');
  const after = await call(srv.base, `/api/chapters/${id}`);
  assert.ok(
    after.mentions.some((m) => m.entity_id === kael.id),
    'the scan links the current revision'
  );
});

test('timeline events keep explicit order, links, and unanchor cleanly', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const kael = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Kael' } });
  const vale = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'The Vale' } });
  const chapter = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', title: 'One', text: 'Kael waited at the gate.' },
  });

  const first = await call(srv.base, '/api/timeline/events', {
    method: 'POST',
    body: {
      title: 'The gate opens',
      summary: 'Kael arrives.',
      chapterId: chapter.chapter.id,
      storyTime: 'Day 3',
      storyDay: 3,
      kind: 'battle',
      entities: [
        { entityId: kael.id, role: 'participant' },
        { entityId: vale.id, role: 'location' },
      ],
    },
  });
  const second = await call(srv.base, '/api/timeline/events', {
    method: 'POST',
    body: { title: 'A quiet morning', storyTime: 'Day 1', storyDay: 0, kind: 'event' },
  });

  let events = await call(srv.base, '/api/timeline/events');
  assert.equal(events.length, 2);
  assert.equal(events[0].id, first.id);
  assert.equal(events[0].story_order, 0);
  assert.equal(events[0].story_day, 3);
  assert.equal(events[1].story_day, 0, 'day 0 is a real day, not a blank');
  assert.equal(events[0].chapter_number, '1');
  assert.equal(events[0].entities.length, 2);
  assert.ok(events[0].entities.some((e) => e.entity_id === kael.id && e.role === 'participant'));
  assert.ok(events[0].entities.some((e) => e.entity_id === vale.id && e.role === 'location'));
  assert.equal(events[1].story_order, 1);
  assert.equal(events[1].chapter_id, null);

  await call(srv.base, `/api/timeline/events/${first.id}`, {
    method: 'PUT',
    body: {
      title: 'The gate opens early',
      summary: 'A reveal.',
      chapterId: null,
      storyTime: 'Day 4',
      storyDay: 12,
      kind: 'reveal',
      entities: [{ entityId: kael.id, role: 'participant' }],
    },
  });
  events = await call(srv.base, '/api/timeline/events');
  assert.equal(events[0].title, 'The gate opens early');
  assert.equal(events[0].story_day, 12, 'an update can move an event to another day');
  assert.equal(events[0].chapter_id, null);
  assert.equal(events[0].kind, 'reveal');
  assert.equal(events[0].entities.length, 1);

  await call(srv.base, '/api/timeline/events/reorder', {
    method: 'PUT',
    body: { ids: [second.id, first.id] },
  });
  events = await call(srv.base, '/api/timeline/events');
  assert.deepEqual(events.map((e) => e.id), [second.id, first.id]);

  // A deleted chapter unanchors the event; a deleted entity removes only its
  // link, never the event itself.
  const linked = await call(srv.base, '/api/timeline/events', {
    method: 'POST',
    body: {
      title: 'The gate closes',
      chapterId: chapter.chapter.id,
      entities: [{ entityId: kael.id, role: 'participant' }],
    },
  });
  await call(srv.base, `/api/chapters/${chapter.chapter.id}`, { method: 'DELETE' });
  events = await call(srv.base, '/api/timeline/events');
  const afterChapter = events.find((e) => e.id === linked.id);
  assert.equal(afterChapter.chapter_id, null);

  await call(srv.base, `/api/entities/${kael.id}`, { method: 'DELETE' });
  events = await call(srv.base, '/api/timeline/events');
  const afterEntity = events.find((e) => e.id === linked.id);
  assert.equal(afterEntity.entities.length, 0);

  const badTitle = await fetch(`${srv.base}/api/timeline/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '   ' }),
  });
  assert.equal(badTitle.status, 400);
  const badChapter = await fetch(`${srv.base}/api/timeline/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Nowhere', chapterId: 999999 }),
  });
  assert.equal(badChapter.status, 400);
  const badEntity = await fetch(`${srv.base}/api/timeline/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Nobody', entities: [{ entityId: 999999 }] }),
  });
  assert.equal(badEntity.status, 400);
  const badOrder = await fetch(`${srv.base}/api/timeline/events/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [first.id] }),
  });
  assert.equal(badOrder.status, 400);

  // A blank story day means undated. Clearing is an explicit null; the list
  // then shows no day or gap for that event.
  await call(srv.base, `/api/timeline/events/${second.id}`, { method: 'PUT', body: { storyDay: null } });
  events = await call(srv.base, '/api/timeline/events');
  assert.equal(events.find((e) => e.id === second.id).story_day, null);

  for (const bad of [-1, 2.5, 'three']) {
    const res = await fetch(`${srv.base}/api/timeline/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bad day', storyDay: bad }),
    });
    assert.equal(res.status, 400, `storyDay ${bad} is rejected`);
  }
});

test('explicit relationships are directional, editable, and merge with their cards', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const aria = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Aria' } });
  const arya = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Arya' } });
  const blade = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'The Blade' } });

  const parent = await call(srv.base, '/api/relationships', {
    method: 'POST',
    body: { sourceId: aria.id, targetId: arya.id, label: 'parent of', notes: 'Raised her alone.' },
  });
  const wielded = await call(srv.base, '/api/relationships', {
    method: 'POST',
    body: { sourceId: arya.id, targetId: blade.id, label: 'wields' },
  });

  let rows = await call(srv.base, `/api/entities/${aria.id}/relationships`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, parent.id);
  assert.equal(rows[0].source_id, aria.id);
  assert.equal(rows[0].target_id, arya.id);
  assert.equal(rows[0].source_name, 'Aria');
  assert.equal(rows[0].target_name, 'Arya');
  assert.equal(rows[0].notes, 'Raised her alone.');

  rows = await call(srv.base, `/api/entities/${arya.id}/relationships`);
  assert.deepEqual(rows.map((r) => r.id).sort(), [parent.id, wielded.id].sort());

  rows = await call(srv.base, '/api/relationships');
  assert.deepEqual(rows.map((r) => r.id).sort(), [parent.id, wielded.id].sort());
  assert.equal(rows.find((r) => r.id === parent.id)?.source_name, 'Aria');
  assert.equal(rows.find((r) => r.id === parent.id)?.target_name, 'Arya');
  assert.equal(rows.find((r) => r.id === parent.id)?.target_trashed_at, null);

  const duplicate = await callError(srv.base, '/api/relationships', {
    method: 'POST',
    body: { sourceId: aria.id, targetId: arya.id, label: 'parent of' },
  });
  assert.equal(duplicate.status, 409);
  const self = await callError(srv.base, '/api/relationships', {
    method: 'POST',
    body: { sourceId: aria.id, targetId: aria.id, label: 'self' },
  });
  assert.equal(self.status, 400);
  const blank = await callError(srv.base, '/api/relationships', {
    method: 'POST',
    body: { sourceId: aria.id, targetId: arya.id, label: '  ' },
  });
  assert.equal(blank.status, 400);

  await call(srv.base, `/api/relationships/${parent.id}`, {
    method: 'PUT',
    body: { label: 'owes', notes: 'A debt neither names.' },
  });
  rows = await call(srv.base, `/api/entities/${arya.id}/relationships`);
  assert.equal(rows.find((r) => r.id === parent.id)?.label, 'owes');

  const event = await call(srv.base, '/api/timeline/events', {
    method: 'POST',
    body: {
      title: 'Arya takes the blade',
      entities: [{ entityId: arya.id, role: 'participant' }],
    },
  });

  // Arya is absorbed into Aria: her relationship to the blade repoints to Aria,
  // while Aria --owes--> Arya collapses to a self-relation and is dropped.
  await call(srv.base, `/api/entities/${aria.id}/merge`, {
    method: 'POST',
    body: { absorbedId: arya.id },
  });
  rows = await call(srv.base, `/api/entities/${aria.id}/relationships`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_id, aria.id);
  assert.equal(rows[0].target_id, blade.id);
  assert.equal(rows[0].label, 'wields');

  const events = await call(srv.base, '/api/timeline/events');
  assert.equal(events.find((e) => e.id === event.id)?.entities[0]?.entity_id, aria.id);

  await call(srv.base, `/api/entities/${blade.id}`, { method: 'DELETE' });
  assert.deepEqual(await call(srv.base, `/api/entities/${aria.id}/relationships`), []);
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

test('accepting a tracked name in several chapters builds one reappearance alert', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  for (let i = 1; i <= 5; i += 1) {
    const text = i === 1 || i === 5 ? 'Mara Voss crossed the yard. Mara Voss waited.' : `Chapter ${i} was quiet.`;
    await call(srv.base, '/api/chapters', { method: 'POST', body: { number: String(i), title: `Ch ${i}`, text } });
  }

  const candidate = (await call(srv.base, '/api/review')).pending.find((c) => c.surface_text === 'Mara Voss');
  assert.ok(candidate, 'expected a candidate for Mara Voss');

  const accepted = await call(srv.base, `/api/candidates/${candidate.id}/resolve`, {
    method: 'POST',
    body: { action: 'accept', tracking: 'reappearance', gapThreshold: 2 },
  });

  const alerts = (await call(srv.base, '/api/review')).alerts.filter((a) => a.entity_id === accepted.entityId);
  assert.equal(alerts.length, 1, `expected one alert, got ${JSON.stringify(alerts)}`);
  assert.equal(alerts[0].kind, 'reappeared');
  assert.equal(alerts[0].detail, 'returns after 3 chapters');
  assert.equal(alerts[0].chapter_number, '5');
});

test('accepting with tracking off changes no alerts and links every chapter', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  // A tracked card with an existing dormant alert must survive the accept untouched.
  const wren = await call(srv.base, '/api/entities', {
    method: 'POST',
    body: { name: 'Wren Hall', tracking: 'absence', gapThreshold: 1 },
  });
  for (let i = 1; i <= 3; i += 1) {
    const text = i <= 2 ? 'Wren Hall waited by the gate.' : 'The gate was empty.';
    await call(srv.base, '/api/chapters', { method: 'POST', body: { number: String(i), title: `Ch ${i}`, text } });
  }
  for (let i = 4; i <= 30; i += 1) {
    await call(srv.base, '/api/chapters', {
      method: 'POST',
      body: { number: String(i), title: `Ch ${i}`, text: 'Ghost Lantern burned on the sill.' },
    });
  }
  const before = (await call(srv.base, '/api/review')).alerts.sort((a, b) => a.id - b.id);
  assert.ok(before.some((a) => a.entity_id === wren.id && a.kind === 'dormant'));

  const candidate = (await call(srv.base, '/api/review')).pending.find((c) => c.surface_text === 'Ghost Lantern');
  assert.ok(candidate, 'expected a candidate for Ghost Lantern');
  const accepted = await call(srv.base, `/api/candidates/${candidate.id}/resolve`, {
    method: 'POST',
    body: { action: 'accept' },
  });

  const detail = await call(srv.base, `/api/entities/${accepted.entityId}`);
  assert.equal(detail.entity.tracking, 'off');
  assert.equal(detail.mentions.length, 27, 'all 27 chapter candidates became mentions');

  const after = (await call(srv.base, '/api/review')).alerts.sort((a, b) => a.id - b.id);
  assert.deepEqual(
    after.map((a) => [a.id, a.kind, a.chapter_id, a.detail, a.state]),
    before.map((a) => [a.id, a.kind, a.chapter_id, a.detail, a.state]),
    'tracking off must not rewrite alerts'
  );
});

test('deleting a chapter only trashes cards that lost their last mention', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', title: 'One', text: 'Mara Voss drew the blade.' },
  });
  await call(srv.base, '/api/chapters', { method: 'POST', body: { number: '2', title: 'Two', text: 'The room was empty.' } });
  const candidate = (await call(srv.base, '/api/review')).pending.find((c) => c.surface_text === 'Mara Voss');
  const accepted = await call(srv.base, `/api/candidates/${candidate.id}/resolve`, {
    method: 'POST',
    body: { action: 'accept' },
  });
  const handmade = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Handmade Card' } });

  const one = (await call(srv.base, '/api/chapters')).find((c) => c.number === '1');
  const result = await call(srv.base, `/api/chapters/${one.id}?renumber=0`, { method: 'DELETE' });
  assert.equal(result.trashed, 1, 'only the card that lost its last mention is trashed');

  const trash = await call(srv.base, '/api/trash');
  assert.ok(trash.some((e) => e.id === accepted.entityId), 'the orphan is in Trash');
  const live = await call(srv.base, '/api/entities');
  assert.ok(live.some((e) => e.id === handmade.id), 'a hand-made card with no mentions survives');
});

test('a trashed card no longer owns its name or aliases', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const kael = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Kael' } });
  await call(srv.base, `/api/entities/${kael.id}/aliases`, {
    method: 'POST',
    body: { alias: 'Mara Voss' },
  });

  await assert.rejects(
    call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Mara Voss' } }),
    /409/,
    'a live alias already answers to this name'
  );

  await call(srv.base, '/api/entities/trash', { method: 'POST', body: { ids: [kael.id] } });
  const born = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Mara Voss' } });

  const chapter = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', title: 'One', text: 'Mara Voss waited by the gate.' },
  });
  const detail = await call(srv.base, `/api/chapters/${chapter.chapter.id}`);
  assert.ok(
    !detail.mentions.some((m) => m.entity_id === kael.id),
    'the scanner must not attach a mention to a trashed card'
  );
  assert.equal((await call(srv.base, `/api/entities/${born.id}`)).mentions.length, 1, 'the live card owns the name');
});

test('a duplicate name is refused with the existing card id', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const kael = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Kael' } });
  const res = await fetch(`${srv.base}/api/entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '  kael ' }),
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).entityId, kael.id);

  // A candidate scanned before the card existed can collide when it is accepted.
  await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', title: 'One', text: 'Mara Voss drew the blade.' },
  });
  const candidate = (await call(srv.base, '/api/review')).pending.find((c) => c.surface_text === 'Mara Voss');
  const mara = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Mara Voss' } });
  const conflict = await fetch(`${srv.base}/api/candidates/${candidate.id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'accept' }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).entityId, mara.id);
  assert.equal((await call(srv.base, '/api/entities')).filter((e) => e.name === 'Mara Voss').length, 1);
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

test('the last opened chapter id round-trips through meta', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const one = await call(srv.base, '/api/chapters', { method: 'POST', body: { number: '1', title: 'One', text: 'Kael.' } });
  const saved = await call(srv.base, '/api/meta', {
    method: 'PUT',
    body: { last_chapter: String(one.chapter.id) },
  });
  assert.equal(saved.last_chapter, one.chapter.id);

  const reopened = await call(srv.base, '/api/meta');
  assert.equal(reopened.last_chapter, one.chapter.id);

  const cleared = await call(srv.base, '/api/meta', { method: 'PUT', body: { last_chapter: '' } });
  assert.equal(cleared.last_chapter, null);

  const bad = await fetch(`${srv.base}/api/meta`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_chapter: 'two' }),
  });
  assert.equal(bad.status, 400, 'a non-numeric chapter id is rejected');
});

test('a chapter can be inserted after another and later chapters shift', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const one = await call(srv.base, '/api/chapters', { method: 'POST', body: { number: '1', title: 'One', text: 'Kael.' } });
  await call(srv.base, '/api/chapters', { method: 'POST', body: { number: '2', title: 'Two', text: 'The room was empty.' } });
  const three = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '3', title: 'Three', text: 'The door closed.' },
  });

  await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1a', title: 'Between', text: 'A new scene.', afterChapterId: one.chapter.id },
  });
  const chapters = await call(srv.base, '/api/chapters');
  assert.deepEqual(chapters.map((c) => c.title), ['One', 'Between', 'Two', 'Three']);
  assert.deepEqual(chapters.map((c) => c.sort_order), [0, 1, 2, 3]);

  const bad = await fetch(`${srv.base}/api/chapters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: '9', title: 'Nowhere', text: 'x', afterChapterId: 99999 }),
  });
  assert.equal(bad.status, 400, 'an unknown insert target is rejected');

  const gun = await call(srv.base, '/api/guns', { method: 'POST', body: { title: 'The brass key', plannedNumber: '4' } });
  const four = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '4', title: 'Four', text: 'The key.', afterChapterId: three.chapter.id },
  });
  const guns = await call(srv.base, '/api/guns');
  const linked = guns.find((g) => g.id === gun.id);
  assert.equal(linked.planned_chapter_id, four.chapter.id, 'inserting the planned chapter arms the gun');
});

test('the export reminder starts due, then a date satisfies it', async (t) => {  const srv = await startServer();
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

// ---------- duels ----------
import { resolveDuel } from './duel.mjs';
import {
  addFighter,
  buildDuelPayload,
  emptyBuilderState,
  toggleAbility,
  toggleItem,
} from '../src/duelbuilder.ts';

function fighterPick(characterId, abilityIds = [], itemIds = []) {
  return { characterId, abilityIds, itemIds };
}

function duelBody(a, b, extra = {}) {
  return { sides: [{ fighters: a }, { fighters: b }], ...extra };
}

async function callError(base, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function makeCast(base) {
  const types = await call(base, '/api/types');
  const characterType = types.find((x) => x.name === 'Character').id;
  const itemType = types.find((x) => x.name === 'Item').id;

  const character = async (name, abilities = []) => {
    const { id } = await call(base, '/api/entities', {
      method: 'POST',
      body: { name, typeId: characterType },
    });
    if (abilities.length) {
      await call(base, `/api/entities/${id}`, {
        method: 'PUT',
        body: { fields: { abilities: abilities.map(([abilityId, abilityName]) => ({ id: abilityId, name: abilityName, body: '' })) } },
      });
    }
    return id;
  };

  const gear = async (name, fields) => {
    const { id } = await call(base, '/api/entities', {
      method: 'POST',
      body: { name, typeId: itemType },
    });
    await call(base, `/api/entities/${id}`, { method: 'PUT', body: { fields } });
    return id;
  };

  const kael = await character('Kael', [
    ['k1', 'Ashfall'],
    ['k2', 'The Long Count'],
  ]);
  const mira = await character('Mira', [
    ['m1', 'Mirror Step'],
    ['m2', 'The Quiet Hour'],
  ]);
  const vane = await character('Vane', [
    ['v1', 'Iron Verdict'],
    ['v2', 'The Slow Cut'],
  ]);
  const sword = await gear('a chipped sword', { rank: 'Hazardous', role: 'offense', owners: [kael] });
  const shield = await gear('a boiled-leather shield', { rank: 'Elusive', role: 'defense', owners: [mira] });
  const blade = await gear('a long grey blade', { rank: 'Desolating', role: 'offense', owners: [vane] });

  return { character, gear, characterType, itemType, kael, mira, vane, sword, shield, blade };
}

async function makeDuel(base, a, b, extra = {}) {
  return call(base, '/api/duels', { method: 'POST', body: duelBody(a, b, extra) });
}

test('the builder payload passes the route and stores exactly its picks', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const c = await makeCast(srv.base);

  let state = addFighter(addFighter(emptyBuilderState('the Rusted Pass'), 'A', c.kael), 'B', c.mira);
  state = toggleAbility(state, 'A', c.kael, 'k1');
  state = toggleAbility(state, 'B', c.mira, 'm2');
  state = toggleItem(state, 'A', c.kael, c.sword);
  state = toggleItem(state, 'B', c.mira, c.shield);

  const payload = buildDuelPayload(state);
  assert.deepEqual(payload, {
    sides: [
      { fighters: [{ characterId: c.kael, abilityIds: ['k1'], itemIds: [c.sword] }] },
      { fighters: [{ characterId: c.mira, abilityIds: ['m2'], itemIds: [c.shield] }] },
    ],
    terrain: 'the Rusted Pass',
    chosenWinner: null,
    skilledSide: null,
  });

  const duel = await call(srv.base, '/api/duels', { method: 'POST', body: payload });
  assert.equal(duel.sides.terrain, 'the Rusted Pass');
  assert.deepEqual(duel.sides.A[0].abilities.map((ability) => ability.name), ['Ashfall']);
  assert.deepEqual(duel.sides.B[0].abilities.map((ability) => ability.name), ['The Quiet Hour']);
  assert.deepEqual(duel.sides.A[0].items.map((item) => item.id), [c.sword]);
  assert.deepEqual(duel.sides.B[0].items.map((item) => item.id), [c.shield]);
});

test('a created duel is a complete snapshot and replays identically', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const c = await makeCast(srv.base);

  const duel = await makeDuel(
    srv.base,
    [fighterPick(c.kael, ['k1', 'k2'], [c.sword])],
    [fighterPick(c.mira, ['m1', 'm2'], [c.shield])],
    { terrain: '  the Rusted Pass  ', skilledSide: 'B' }
  );

  assert.equal(duel.title, 'Kael vs Mira');
  assert.equal(duel.sides.terrain, 'the Rusted Pass', 'terrain is trimmed');
  assert.deepEqual(
    duel.sides.A[0].abilities.map((a) => a.name),
    ['Ashfall', 'The Long Count']
  );
  assert.equal(duel.sides.A[0].items[0].rank, 'Hazardous');
  assert.equal(duel.sides.A[0].items[0].role, 'offense');
  assert.equal(duel.sides.B[0].items[0].role, 'defense');
  assert.ok(Number.isInteger(duel.outcome.seed));
  assert.ok(duel.outcome.seed >= 0 && duel.outcome.seed < 2 ** 32);
  assert.equal(typeof duel.outcome.roll, 'number');
  assert.equal(typeof duel.outcome.probabilityA, 'number');
  for (const side of ['A', 'B']) {
    const part = duel.outcome.breakdown[side];
    assert.equal(part.score, (part.raw + part.numbers) * part.multiplier);
    for (const fighter of part.fighters) {
      assert.equal(
        fighter.total,
        fighter.base + fighter.powerPoints + fighter.abilityPoints + fighter.attack + fighter.defence
      );
    }
  }
  assert.equal(duel.outcome.breakdown.B.skilled, true);
  assert.equal(duel.outcome.breakdown.B.multiplier, 1.5);
  assert.equal(duel.outcome.scores.A, duel.outcome.breakdown.A.score);
  assert.equal(duel.outcome.scores.B, duel.outcome.breakdown.B.score);
  assert.deepEqual(
    duel.outcome.breakdown.A.fighters.map((f) => f.name),
    ['Kael']
  );
  assert.match(duel.narrative, /Kael/);

  const replay = resolveDuel({
    sides: { A: duel.sides.A, B: duel.sides.B },
    seed: duel.outcome.seed,
    chosenWinner: duel.outcome.chosenBy,
    skilledSide: duel.outcome.skillSide,
    terrain: duel.sides.terrain,
  });
  assert.equal(replay.outcome.winnerSide, duel.outcome.winnerSide);
  assert.equal(replay.outcome.scores.A, duel.outcome.scores.A);
  assert.equal(replay.outcome.scores.B, duel.outcome.scores.B);
  assert.equal(replay.narrative, duel.narrative);
});

test('a chosen winner is honoured and the skill side is dropped', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const c = await makeCast(srv.base);

  const duel = await makeDuel(
    srv.base,
    [fighterPick(c.kael, ['k1'], [c.sword])],
    [fighterPick(c.mira, ['m1'], [c.shield])],
    { chosenWinner: 'A', skilledSide: 'B', terrain: 'the flooded mill' }
  );

  assert.equal(duel.outcome.winnerSide, 'A');
  assert.equal(duel.outcome.chosenBy, 'A');
  assert.equal(duel.outcome.skillSide, null);
  assert.equal(duel.outcome.breakdown.A.skilled, false);
  assert.equal(duel.outcome.breakdown.B.skilled, false);
});

test('a 3v3 is accepted, including a shared Item on one side', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const c = await makeCast(srv.base);
  const sable = await c.character('Sable', [['s1', 'Salt Wind']]);
  const orin = await c.character('Orin', [['o1', 'Glass Hour']]);
  const tamsin = await c.character('Tamsin', [['t1', 'The Slow Cut']]);
  const spear = await c.gear('a shared spear', { rank: 'Elusive', owners: [c.kael, c.mira] });

  const duel = await makeDuel(
    srv.base,
    [
      fighterPick(c.kael, ['k1'], [spear]),
      fighterPick(c.mira, ['m1'], [spear]),
      fighterPick(c.vane, ['v1']),
    ],
    [fighterPick(sable, ['s1']), fighterPick(orin, ['o1']), fighterPick(tamsin, ['t1'])],
    { terrain: 'the Rusted Pass', chosenWinner: 'A' }
  );

  assert.equal(duel.title, 'Kael + Mira + Vane vs Sable + Orin + Tamsin');
  assert.equal(duel.sides.A.length, 3);
  assert.equal(duel.sides.B.length, 3);
  assert.equal(duel.sides.A[0].items[0].name, 'a shared spear');
  assert.equal(duel.sides.A[1].items[0].name, 'a shared spear');
  assert.equal(duel.sides.A[0].items[0].role, 'both', 'an absent role means both');
  assert.deepEqual(
    duel.outcome.breakdown.A.fighters.map((f) => f.name),
    ['Kael', 'Mira', 'Vane']
  );
  assert.equal(duel.outcome.scores.A, duel.outcome.breakdown.A.score);
  for (const side of ['A', 'B']) {
    const part = duel.outcome.breakdown[side];
    assert.equal(part.score, (part.raw + part.numbers) * part.multiplier);
    for (const fighter of part.fighters) {
      assert.equal(
        fighter.total,
        fighter.base + fighter.powerPoints + fighter.abilityPoints + fighter.attack + fighter.defence
      );
    }
  }
  const words = duel.narrative.split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 120 && words <= 220, `${words} words`);
});

test('invalid duel payloads return 4xx and write nothing', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const c = await makeCast(srv.base);
  const base = srv.base;

  const gone = await c.character('Gone');
  await call(base, '/api/entities/trash', { method: 'POST', body: { ids: [gone] } });
  const sable = await c.character('Sable');
  const orin = await c.character('Orin');
  const shared = await c.gear('a shared blade', { rank: 'Elusive', owners: [c.kael, c.mira] });

  const cases = [
    [{ sides: [] }, /exactly two/],
    [duelBody([], [fighterPick(c.mira)]), /1 to 3 fighters/],
    [
      duelBody(
        [fighterPick(c.kael), fighterPick(c.mira), fighterPick(c.vane), fighterPick(sable)],
        [fighterPick(orin)]
      ),
      /1 to 3 fighters/,
    ],
    [duelBody([fighterPick(999999)], [fighterPick(c.mira)]), /missing or in Trash/],
    [duelBody([fighterPick(gone)], [fighterPick(c.mira)]), /missing or in Trash/],
    [duelBody([fighterPick(c.sword)], [fighterPick(c.mira)]), /is not a Character/],
    [duelBody([fighterPick(c.kael)], [fighterPick(c.kael)]), /cannot appear twice/],
    [duelBody([fighterPick(c.kael, ['m1'])], [fighterPick(c.mira)]), /does not belong/],
    [duelBody([fighterPick(c.kael, ['k1', 'k2', 'k1', 'k2'])], [fighterPick(c.mira)]), /at most 3 abilities/],
    [duelBody([fighterPick(c.kael, [], [c.shield])], [fighterPick(c.mira)]), /does not hold/],
    [
      duelBody([fighterPick(c.kael, [], [shared])], [fighterPick(c.mira, [], [shared])]),
      /cannot be used on both sides/,
    ],
    [duelBody([fighterPick(c.kael)], [fighterPick(c.mira)], { terrain: 'x'.repeat(81) }), /80 characters/],
    [duelBody([fighterPick(c.kael)], [fighterPick(c.mira)], { chosenWinner: 'C' }), /chosenWinner/],
    [duelBody([fighterPick(c.kael)], [fighterPick(c.mira)], { skilledSide: 'C' }), /skilledSide/],
    [duelBody([{ characterId: c.kael, abilityIds: 'k1' }], [fighterPick(c.mira)]), /must be an array/],
    [duelBody([{ characterId: c.kael, itemIds: '10' }], [fighterPick(c.mira)]), /must be an array/],
  ];

  for (const [payload, message] of cases) {
    const res = await callError(base, '/api/duels', { method: 'POST', body: payload });
    assert.equal(res.status, 400, `${JSON.stringify(payload)} -> ${res.status} ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, message);
  }

  assert.deepEqual(await call(base, '/api/duels'), [], 'no failed attempt left a record');
});

test('a duel survives deleting its fighters and can still be deleted', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const c = await makeCast(srv.base);

  const duel = await makeDuel(
    srv.base,
    [fighterPick(c.kael, ['k1'], [c.sword])],
    [fighterPick(c.mira, ['m1'], [c.shield])],
    { terrain: 'the narrow stair' }
  );

  await call(srv.base, `/api/entities/${c.kael}`, { method: 'DELETE' });
  await call(srv.base, `/api/entities/${c.mira}`, { method: 'DELETE' });

  const list = await call(srv.base, '/api/duels');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, duel.id);
  assert.equal(list[0].sides.A[0].name, 'Kael');
  assert.equal(list[0].sides.B[0].name, 'Mira');
  assert.equal(list[0].narrative, duel.narrative);

  await call(srv.base, `/api/duels/${duel.id}`, { method: 'DELETE' });
  assert.deepEqual(await call(srv.base, '/api/duels'), []);
  const again = await callError(srv.base, `/api/duels/${duel.id}`, { method: 'DELETE' });
  assert.equal(again.status, 404);
});

test('merging a fighter leaves an existing duel unchanged', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const c = await makeCast(srv.base);

  await makeDuel(
    srv.base,
    [fighterPick(c.kael, ['k1'], [c.sword])],
    [fighterPick(c.mira, ['m1'], [c.shield])],
    { terrain: 'the Rusted Pass' }
  );
  const before = await call(srv.base, '/api/duels');

  await call(srv.base, `/api/entities/${c.kael}/merge`, {
    method: 'POST',
    body: { absorbedId: c.mira },
  });

  const after = await call(srv.base, '/api/duels');
  assert.deepEqual(after, before);
  assert.equal(after[0].sides.B[0].name, 'Mira', 'the snapshot still names the absorbed fighter');
});

test('changing an Item role later does not change a stored duel', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const c = await makeCast(srv.base);

  await makeDuel(
    srv.base,
    [fighterPick(c.kael, ['k1'], [c.sword])],
    [fighterPick(c.mira, ['m1'])],
    { terrain: 'the Rusted Pass' }
  );

  await call(srv.base, `/api/entities/${c.sword}`, {
    method: 'PUT',
    body: { fields: { rank: 'Hazardous', role: 'defense', owners: [c.kael] } },
  });

  const [stored] = await call(srv.base, '/api/duels');
  assert.equal(stored.sides.A[0].items[0].role, 'offense');

  const fresh = await call(srv.base, `/api/entities/${c.sword}`);
  assert.equal(JSON.parse(fresh.entity.fields).role, 'defense');
});

test('GET /api/duels returns newest first', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const c = await makeCast(srv.base);

  const first = await makeDuel(
    srv.base,
    [fighterPick(c.kael, ['k1'])],
    [fighterPick(c.mira, ['m1'])],
    { terrain: 'the Rusted Pass' }
  );
  const second = await makeDuel(
    srv.base,
    [fighterPick(c.vane, ['v1'])],
    [fighterPick(c.mira, ['m1'])],
    { terrain: 'the flooded mill' }
  );

  const list = await call(srv.base, '/api/duels');
  assert.deepEqual(
    list.map((d) => d.id),
    [second.id, first.id]
  );

  const res = await fetch(`${srv.base}/api/export`);
  assert.equal(res.status, 200);
  const md = await res.text();
  assert.match(md, /^### Duels$/m);
  assert.ok(
    md.indexOf(`#### ${second.title}`) < md.indexOf(`#### ${first.title}`),
    'the export uses the same newest-first order as the list'
  );
});

test('an Item role is exported only when it is explicitly set', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const c = await makeCast(srv.base);
  await c.gear('a plain ring', { rank: 'Mundane' });

  const res = await fetch(`${srv.base}/api/export`);
  assert.equal(res.status, 200);
  const md = await res.text();
  // The cast has three Items with a stored role (two offense, one defense) and
  // the plain ring has none, so the line appears exactly three times.
  assert.equal((md.match(/^- Role: Offense$/gm) ?? []).length, 2);
  assert.equal((md.match(/^- Role: Defense$/gm) ?? []).length, 1);
  const ring = md.slice(md.indexOf('#### a plain ring'));
  const nextCard = ring.indexOf('\n####', 1);
  assert.doesNotMatch(nextCard === -1 ? ring : ring.slice(0, nextCard), /Role:/);
});

test('auto gun scan stores candidates hidden, and Add creates a bare gun', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const chapter = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: {
      number: '1',
      text: 'Maren carried the brass key. The brass key was cold. Maren carried the brass key to the vault.',
    },
  });

  const pending = await call(srv.base, '/api/guns/candidates');
  const key = pending.find((c) => c.normalized === 'brass key');
  assert.ok(key, 'the auto scan found the key');
  assert.equal(key.tier, 'primary');
  assert.equal(key.chapter_id, chapter.chapter.id);
  assert.equal((await call(srv.base, '/api/guns/review')).due, true);

  await call(srv.base, '/api/guns/review/later', { method: 'POST' });
  assert.equal((await call(srv.base, '/api/guns/review')).due, false);

  await call(srv.base, `/api/guns/candidates/${key.id}/resolve`, {
    method: 'POST',
    body: { action: 'accept', title: 'The brass key' },
  });
  const guns = await call(srv.base, '/api/guns');
  assert.equal(guns.length, 1);
  assert.equal(guns[0].title, 'The brass key');
  assert.equal(guns[0].appearance_chapter_id, chapter.chapter.id);
  assert.equal(guns[0].planned_number, '');
  assert.equal(guns[0].impact, '');
  assert.equal((await call(srv.base, '/api/guns/candidates')).length, 0);
});

test('ignoring a gun is global and survives a later chapter scan', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', text: 'Maren carried the brass key. The brass key was cold.' },
  });
  const [key] = await call(srv.base, '/api/guns/candidates');
  await call(srv.base, `/api/guns/candidates/${key.id}/resolve`, {
    method: 'POST',
    body: { action: 'reject' },
  });

  await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '2', text: 'Dov found the brass key. The brass key was still cold.' },
  });
  const pending = await call(srv.base, '/api/guns/candidates');
  assert.ok(!pending.some((c) => c.normalized === 'brass key'));
});

test('a manual gun scan replaces pending results but not the automatic first pass', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);
  const chapter = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', text: 'Maren carried the brass key. The brass key was cold.' },
  });

  await call(srv.base, `/api/chapters/${chapter.chapter.id}`, {
    method: 'PUT',
    body: { text: 'Maren carried the silver locket. The silver locket was warm.' },
  });
  assert.ok(
    (await call(srv.base, '/api/guns/candidates')).some((c) => c.normalized === 'brass key'),
    'a later revision does not auto-scan'
  );

  await call(srv.base, '/api/guns/scan', {
    method: 'POST',
    body: { chapterIds: [chapter.chapter.id] },
  });
  const pending = await call(srv.base, '/api/guns/candidates');
  assert.ok(!pending.some((c) => c.normalized === 'brass key'));
  assert.ok(pending.some((c) => c.normalized === 'silver locket'));
});

test('a multi-chapter gun scan matches scanning each chapter alone', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const texts = [
    'Maren set the brass key on the table. The brass key was cold. She carried the brass key to the vault.',
    'He carried the silver locket. The silver locket was warm. He hid the silver locket in the drawer.',
    'They carried the iron compass. The iron compass was heavy. They followed the iron compass north.',
  ];
  for (const [index, text] of texts.entries()) {
    await call(srv.base, '/api/chapters', {
      method: 'POST',
      body: { number: String(index + 1), title: `Ch ${index + 1}`, text },
    });
  }

  const chapterIds = (await call(srv.base, '/api/chapters')).map((c) => c.id);
  const together = await call(srv.base, '/api/guns/scan', { method: 'POST', body: { chapterIds } });
  assert.ok(together.created > 0, 'the fixture produces guns');

  const separately = [];
  for (const chapterId of chapterIds) {
    const one = await call(srv.base, '/api/guns/scan', { method: 'POST', body: { chapterIds: [chapterId] } });
    separately.push(one.chapters[0]);
  }
  assert.deepEqual(together.chapters, separately);
});

test('entity lists omit the portrait but keep a working image route', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const { id } = await call(srv.base, '/api/entities', {
    method: 'POST',
    body: { name: 'Portrait Card' },
  });
  await call(srv.base, `/api/entities/${id}`, {
    method: 'PUT',
    body: { fields: { rank: 'A', image: dataUrl } },
  });

  const list = await call(srv.base, '/api/entities');
  const card = list.find((e) => e.id === id);
  assert.equal(card.has_image, 1);
  assert.equal(JSON.parse(card.fields).image, undefined, 'the list drops the base64 image');
  assert.equal(JSON.parse(card.fields).rank, 'A', 'other fields survive the strip');

  const detail = await call(srv.base, `/api/entities/${id}`);
  assert.equal(JSON.parse(detail.entity.fields).image, dataUrl, 'the editor still gets the full card');

  const image = await fetch(`${srv.base}/api/entities/${id}/image`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);

  const empty = await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'No Portrait' } });
  assert.equal((await fetch(`${srv.base}/api/entities/${empty.id}/image`)).status, 404);

  await call(srv.base, `/api/entities/${id}`, { method: 'PUT', body: { fields: { image: 'not-a-data-url' } } });
  assert.equal((await fetch(`${srv.base}/api/entities/${id}/image`)).status, 404);
});

test('entity lists count mentions and chapters in one grouped pass', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  await call(srv.base, '/api/entities', { method: 'POST', body: { name: 'Kael' } });
  const one = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '1', title: 'One', text: 'Kael drew the blade.' },
  });
  await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: { number: '2', title: 'Two', text: 'Kael ran. Kael stopped.' },
  });

  const card = (await call(srv.base, '/api/entities')).find((e) => e.name === 'Kael');
  assert.equal(card.mention_count, 3);
  assert.equal(card.first_chapter, '1');
  assert.equal(card.last_chapter, '2');

  const chapters = await call(srv.base, '/api/chapters');
  const first = chapters.find((c) => c.id === one.chapter.id);
  assert.equal(first.mention_count, 1);
  assert.equal(first.candidate_count, 0);
});

test('review ships bounded rows and a candidate detail route', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const created = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: {
      number: '1',
      title: 'One',
      text: 'Mara Voss crossed the yard. Mara Voss waited. The Silver Order marched east.',
    },
  });

  const review = await call(srv.base, '/api/review');
  assert.ok(review.pending.length > 0);
  for (const c of review.pending) {
    assert.ok(!('positions' in c), 'positions are left to the detail route');
    assert.ok(JSON.parse(c.contexts).length <= 1, 'only one context rides on a list row');
  }
  assert.equal(review.pendingTotals.primary, review.pending.filter((c) => c.tier !== 'demoted').length);
  assert.equal(typeof review.pendingTotals.demoted, 'number');

  const page = await call(srv.base, '/api/review/pending?tier=primary&offset=0&limit=1');
  assert.equal(page.pending.length, 1);
  assert.equal(page.total, review.pendingTotals.primary);
  assert.equal(page.hasMore, page.total > 1);

  const full = await call(srv.base, `/api/candidates/${review.pending[0].id}`);
  assert.ok(Array.isArray(JSON.parse(full.positions)));
  assert.ok(JSON.parse(full.contexts).length >= 1);

  const detail = await call(srv.base, `/api/chapters/${created.chapter.id}`);
  assert.ok(detail.candidates.length > 0);
  for (const c of detail.candidates) {
    for (const p of JSON.parse(c.positions)) {
      assert.deepEqual(Object.keys(p).sort(), ['end', 'start']);
    }
  }
});

test('event candidates are read-only prose proposals, never events', async (t) => {
  const srv = await startServer();
  t.after(srv.stop);

  const created = await call(srv.base, '/api/chapters', {
    method: 'POST',
    body: {
      number: '1',
      title: 'One',
      text: 'In 1204 the siege ended. Mara drew her sword and said nothing. Three years later she returned to the keep.',
    },
  });

  let candidates = await call(srv.base, `/api/chapters/${created.chapter.id}/event-candidates`);
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map((c) => c.story_time),
    ['In 1204', 'Three years later']
  );
  assert.ok(candidates.every((c) => c.chapter_id === created.chapter.id));

  // Reading proposals must not create events.
  assert.deepEqual(await call(srv.base, '/api/timeline/events'), []);

  await call(srv.base, '/api/timeline/events', {
    method: 'POST',
    body: { title: 'In 1204 the siege ended.', chapterId: created.chapter.id },
  });
  candidates = await call(srv.base, `/api/chapters/${created.chapter.id}/event-candidates`);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].story_time, 'Three years later');

  const missing = await callError(srv.base, '/api/chapters/999999/event-candidates');
  assert.equal(missing.status, 404);
});
