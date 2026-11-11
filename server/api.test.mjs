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
