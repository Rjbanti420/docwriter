// Unit tests for the duel engine. Run with `npm test`
// (node --test server/*.test.mjs). No database is touched.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEM_RANKS,
  buildNarrative,
  itemRankValue,
  mulberry32,
  narrativeWordCap,
  normalizeRole,
  powerRankMap,
  resolveDuel,
  scoreFighter,
  scoreSide,
  snapshotCombatants,
  winProbability,
} from './duel.mjs';

const ability = (n) => ({ id: `a${n}`, name: `Move ${n}`, body: '' });
const item = (id, rank, role = 'offense', name = `item ${id}`) => ({ id, name, rank, role });
const fighter = (patch = {}) => ({
  characterId: 1,
  name: 'A',
  dead: false,
  powerRank: 1,
  abilities: [],
  items: [],
  ...patch,
});

// Kael and Mira are exactly matched at 20: power 2 (4), 2 abilities (3),
// one Hazardous Item (3).
const equal = {
  A: [
    fighter({
      characterId: 1,
      name: 'Kael',
      powerRank: 2,
      abilities: [ability(1), ability(2)],
      items: [item(10, 'Hazardous', 'offense', 'a chipped sword')],
    }),
  ],
  B: [
    fighter({
      characterId: 2,
      name: 'Mira',
      powerRank: 2,
      abilities: [ability(1), ability(2)],
      items: [item(11, 'Hazardous', 'defense', 'a boiled-leather shield')],
    }),
  ],
};

const gap = {
  A: [
    fighter({
      characterId: 1,
      name: 'Kael',
      powerRank: 1,
      abilities: [ability(1)],
      items: [item(10, 'Elusive', 'offense', 'a short knife')],
    }),
  ],
  B: [
    fighter({
      characterId: 2,
      name: 'Vane',
      powerRank: 4,
      abilities: [ability(1), ability(2), ability(3)],
      items: [item(11, 'Elusive', 'offense', 'a short knife')],
    }),
  ],
};

// Two fighters against one, with the lone side stronger but not enough.
const pair = {
  A: [
    fighter({
      characterId: 1,
      name: 'Kael',
      powerRank: 2,
      abilities: [ability(1), ability(2)],
      items: [item(10, 'Hazardous', 'offense', 'a chipped sword')],
    }),
    fighter({ characterId: 2, name: 'Ren', powerRank: 1, abilities: [ability(1)] }),
  ],
  B: [
    fighter({
      characterId: 3,
      name: 'Vane',
      powerRank: 4,
      abilities: [ability(1), ability(2), ability(3)],
      items: [item(11, 'Desolating', 'offense', 'a long grey blade')],
    }),
  ],
};

const armourOpponent = fighter({
  characterId: 2,
  name: 'Vane',
  powerRank: 3,
  abilities: [ability(1), ability(2)],
  items: [item(11, 'Desolating', 'offense', 'a long grey blade')],
});
const withArmour = {
  A: [
    fighter({
      characterId: 1,
      name: 'Kael',
      powerRank: 3,
      abilities: [ability(1), ability(2)],
      items: [
        item(10, 'Desolating', 'offense', 'a long grey blade'),
        item(12, 'Cataclysmic', 'defense', 'a riveted cuirass'),
      ],
    }),
  ],
  B: [armourOpponent],
};
const withoutArmour = { A: [fighter({ ...withArmour.A[0], items: [item(10, 'Desolating', 'offense', 'a long grey blade')] })], B: [armourOpponent] };

// ---------- ranks and roles ----------

test('item ranks are positional, with unranked and unknown at 0', () => {
  assert.deepEqual(ITEM_RANKS, ['Mundane', 'Elusive', 'Hazardous', 'Desolating', 'Cataclysmic', 'Singular']);
  assert.equal(itemRankValue('Mundane'), 1);
  assert.equal(itemRankValue('Singular'), 6);
  assert.equal(itemRankValue(''), 0);
  assert.equal(itemRankValue('Legendary'), 0);
});

test('an absent or unknown role means Both; the four known roles survive', () => {
  assert.equal(normalizeRole(undefined), 'both');
  assert.equal(normalizeRole(''), 'both');
  assert.equal(normalizeRole('Offense'), 'offense');
  assert.equal(normalizeRole('defense'), 'defense');
  assert.equal(normalizeRole('none'), 'none');
  assert.equal(normalizeRole('shield'), 'both');
});

test('power rank is list position, so a gap in sort_order does not inflate it', () => {
  const ranks = powerRankMap([
    { id: 7, sort_order: 0 },
    { id: 9, sort_order: 5 },
  ]);
  assert.equal(ranks.get(7), 1);
  assert.equal(ranks.get(9), 2);
});

// ---------- scoring ----------

test('Both counts on attack and defence; Offense only attack; Defense only defence; None neither', () => {
  const withRole = (role) =>
    scoreFighter({ powerRank: 0, abilities: [], items: [item(1, 'Singular', role)] });

  assert.deepEqual(
    [withRole('both').attack, withRole('both').defence, withRole('both').total],
    [6, 6, 22]
  );
  assert.deepEqual([withRole('offense').attack, withRole('offense').defence], [6, 0]);
  assert.deepEqual([withRole('defense').attack, withRole('defense').defence], [0, 6]);
  assert.deepEqual([withRole('none').attack, withRole('none').defence, withRole('none').total], [0, 0, 10]);
});

test('attack and defence take the best Item, not the sum of the bag', () => {
  const score = scoreFighter({
    powerRank: 0,
    abilities: [],
    items: [item(1, 'Hazardous'), item(2, 'Singular'), item(3, 'Mundane')],
  });
  assert.equal(score.attack, 6);
  assert.equal(score.total, 16);
});

test('empty ability and item lists do not crash', () => {
  assert.equal(scoreFighter({}).total, 10);
  assert.equal(scoreFighter({ abilities: [], items: [] }).total, 10);
  assert.equal(scoreSide([]).score, 0);
});

test('abilities score at most three, and only the stored order counts', () => {
  const three = scoreFighter({ abilities: [ability(1), ability(2), ability(3)] });
  const four = scoreFighter({ abilities: [ability(1), ability(2), ability(3), ability(4)] });
  assert.equal(three.total, 14.5);
  assert.equal(four.total, three.total);
});

test('the numbers edge is (fighters - 1) x 2 and skill multiplies the side', () => {
  const side = scoreSide([fighter(), fighter()]);
  assert.equal(side.raw, 24); // 10 + power 1 (2) each
  assert.equal(side.numbers, 2);
  assert.equal(side.score, 26);
  assert.equal(scoreSide([fighter(), fighter()], { skilled: true }).score, 39);
});

// ---------- probability ----------

test('the probability is clamped at both extremes', () => {
  assert.equal(winProbability(1, 1000), 0.15);
  assert.equal(winProbability(1000, 1), 0.85);
  assert.equal(winProbability(0, 0), 0.5);
  assert.ok(Math.abs(winProbability(15.5, 24.5) - 0.3875) < 1e-12);
});

// ---------- deterministic outcome ----------

test('fixed seeds give exact, pinned winners', () => {
  const equalA = resolveDuel({ sides: equal, seed: 7 });
  assert.equal(equalA.outcome.scores.A, 20);
  assert.equal(equalA.outcome.scores.B, 20);
  assert.equal(equalA.probabilityA, 0.5);
  assert.equal(equalA.outcome.winnerSide, 'A');

  assert.equal(resolveDuel({ sides: equal, seed: 1 }).outcome.winnerSide, 'B');
  assert.equal(resolveDuel({ sides: gap, seed: 1 }).outcome.winnerSide, 'B');
  assert.equal(resolveDuel({ sides: pair, seed: 6 }).outcome.winnerSide, 'A');
});

test('the same seed replays identically', () => {
  const once = resolveDuel({ sides: pair, seed: 6, terrain: 'the Rusted Pass' });
  const twice = resolveDuel({ sides: pair, seed: 6, terrain: 'the Rusted Pass' });
  assert.deepEqual(twice, once);
  assert.deepEqual(mulberry32(6)(), mulberry32(6)());
});

test('2v1 beats 1v1 with everything else equal', () => {
  const same = (id, name) => fighter({ characterId: id, name, powerRank: 2, abilities: [ability(1), ability(2)] });
  const result = resolveDuel({ sides: { A: [same(1, 'Kael'), same(2, 'Ren')], B: [same(3, 'Vane')] }, seed: 6 });
  assert.ok(result.scorecard.A.score > result.scorecard.B.score);
  assert.ok(result.probabilityA > 0.5);
  assert.equal(result.outcome.winnerSide, 'A');
});

test('a skilled-side pick flips a close matchup', () => {
  const plain = resolveDuel({ sides: equal, seed: 6 });
  const skilled = resolveDuel({ sides: equal, seed: 6, skilledSide: 'A' });
  assert.equal(plain.outcome.winnerSide, 'B');
  assert.equal(plain.probabilityA, 0.5);
  assert.equal(skilled.scorecard.A.score, 30); // 20 x 1.5
  assert.equal(skilled.probabilityA, 0.6);
  assert.equal(skilled.outcome.winnerSide, 'A');
  assert.equal(skilled.outcome.skillSide, 'A');
});

test('strong armour beats no armour: same seed, one Item, opposite result', () => {
  const bare = resolveDuel({ sides: withoutArmour, seed: 6 });
  const armoured = resolveDuel({ sides: withArmour, seed: 6 });
  assert.equal(bare.outcome.scores.A, 23);
  assert.equal(armoured.outcome.scores.A, 28);
  assert.equal(bare.outcome.winnerSide, 'B');
  assert.equal(armoured.outcome.winnerSide, 'A');
});

test('a chosen winner always wins, even against a much higher score', () => {
  const result = resolveDuel({ sides: pair, seed: 6, chosenWinner: 'B', skilledSide: 'A' });
  assert.ok(result.outcome.scores.B < result.outcome.scores.A);
  assert.equal(result.outcome.winnerSide, 'B');
  assert.equal(result.outcome.chosenBy, 'B');
  assert.equal(result.outcome.skillSide, null, 'the skill question is not asked once a winner is chosen');
});

test('an invalid seed or a bad side choice is refused', () => {
  assert.throws(() => resolveDuel({ sides: equal, seed: 1.5 }), /seed/);
  assert.throws(() => resolveDuel({ sides: equal, seed: 1, chosenWinner: 'C' }), /chosenWinner/);
  assert.throws(() => resolveDuel({ sides: equal, seed: 1, skilledSide: 'C' }), /skilledSide/);
  assert.throws(() => resolveDuel({ sides: { A: [], B: [fighter()] }, seed: 1 }), /at least one/);
});

// ---------- duplicates and sharing ----------

test('the same character cannot be on both sides', () => {
  assert.throws(
    () => resolveDuel({ sides: { A: [fighter({ characterId: 1 })], B: [fighter({ characterId: 1 })] }, seed: 1 }),
    /more than once/
  );
});

test('the same Item may be shared on one side but never across sides', () => {
  const shared = item(7, 'Hazardous', 'both');
  assert.doesNotThrow(() =>
    resolveDuel({
      sides: {
        A: [fighter({ characterId: 1, items: [shared] }), fighter({ characterId: 2, items: [shared] })],
        B: [fighter({ characterId: 3 })],
      },
      seed: 1,
    })
  );
  assert.throws(
    () =>
      resolveDuel({
        sides: {
          A: [fighter({ characterId: 1, items: [shared] })],
          B: [fighter({ characterId: 2, items: [shared] })],
        },
        seed: 1,
      }),
    /item 7/
  );
});

// ---------- snapshots ----------

test('snapshotCombatants freezes names, dead marks, abilities, held Items and power ranks', () => {
  const snapshot = snapshotCombatants({
    sides: { A: [{ characterId: 1, abilityIds: ['a2'] }, { characterId: 2 }], B: [{ characterId: 3 }] },
    characters: [
      {
        id: 1,
        name: 'Kael',
        fields: {
          power_level: 1,
          abilities: [ability(1), ability(2)],
          death: { chapter: 2, at: 5 },
        },
      },
      { id: 2, name: 'Ren', fields: { power_level: 2 } },
      { id: 3, name: 'Vane', fields: {} },
    ],
    items: [
      { id: 7, name: 'a chipped sword', fields: { rank: 'Hazardous', owners: [1] } },
      { id: 8, name: 'a rusted key', fields: { owners: [1] } },
      { id: 9, name: 'a long grey blade', fields: { rank: 'Desolating', owners: [3] } },
    ],
    powerLevels: [
      { id: 1, sort_order: 0 },
      { id: 2, sort_order: 5 },
    ],
  });

  assert.equal(snapshot.A[0].name, 'Kael');
  assert.equal(snapshot.A[0].dead, true);
  assert.equal(snapshot.A[0].powerRank, 1);
  assert.deepEqual(snapshot.A[0].abilities, [{ id: 'a2', name: 'Move 2' }]);
  assert.deepEqual(snapshot.A[0].items, [
    { id: 7, name: 'a chipped sword', rank: 'Hazardous', role: 'both' },
    { id: 8, name: 'a rusted key', rank: '', role: 'both' },
  ]);
  assert.equal(snapshot.A[1].powerRank, 2, 'second rung of the ladder');
  assert.equal(snapshot.A[1].dead, false);
  assert.equal(snapshot.B[0].powerRank, 0, 'no power level scores 0');
  assert.deepEqual(snapshot.B[0].items.map((held) => held.name), ['a long grey blade']);
  assert.throws(
    () => snapshotCombatants({ sides: { A: [{ characterId: 99 }], B: [] }, characters: [] }),
    /not found/
  );
});

// ---------- narration ----------

const kael = (patch = {}) =>
  fighter({
    characterId: 101,
    name: 'Kael',
    powerRank: 2,
    abilities: [
      { id: 'k1', name: 'Ashfall', body: '' },
      { id: 'k2', name: 'The Long Count', body: '' },
    ],
    items: [item(110, 'Hazardous', 'offense', 'a chipped sword'), item(111, 'Elusive', 'defense', 'a boiled-leather shield')],
    ...patch,
  });
const mira = (patch = {}) =>
  fighter({
    characterId: 102,
    name: 'Mira',
    powerRank: 2,
    abilities: [
      { id: 'm1', name: 'Mirror Step', body: '' },
      { id: 'm2', name: 'The Quiet Hour', body: '' },
    ],
    items: [item(120, 'Hazardous', 'offense', 'a long grey blade')],
    ...patch,
  });
const ren = (patch = {}) =>
  fighter({
    characterId: 103,
    name: 'Ren',
    powerRank: 1,
    abilities: [
      { id: 'r1', name: 'Nine Breaths', body: '' },
      { id: 'r2', name: 'The Low Guard', body: '' },
    ],
    items: [item(130, 'Elusive', 'offense', 'a short knife')],
    ...patch,
  });
const vane = (patch = {}) =>
  fighter({
    characterId: 104,
    name: 'Vane',
    powerRank: 4,
    abilities: [
      { id: 'v1', name: 'Iron Verdict', body: '' },
      { id: 'v2', name: 'The Slow Cut', body: '' },
    ],
    items: [item(140, 'Desolating', 'offense', 'a long grey blade')],
    ...patch,
  });

const castEqual = { A: [kael()], B: [mira()] };
const castPair = { A: [kael(), ren()], B: [vane()] };
const castTeams = { A: [kael(), ren()], B: [mira(), vane()] };

const wordsOf = (text) => text.split(/\s+/).filter(Boolean).length;
const has = (text, name) => text.toLowerCase().includes(name.toLowerCase());
const lastSentence = (text) => (text.match(/[^.]+\./g) ?? []).pop() ?? '';

test('the narrative names the winner, its signature move and its decisive Item', () => {
  const result = resolveDuel({ sides: castEqual, seed: 7, terrain: 'the Rusted Pass' });
  assert.match(result.narrative, /the Rusted Pass/);
  assert.match(result.narrative, /Kael/);
  assert.match(result.narrative, /Ashfall/);
  assert.match(result.narrative, /a chipped sword/);
  assert.match(result.narrative, /Mira/);
  assert.ok(wordsOf(result.narrative) >= 120 && wordsOf(result.narrative) <= 220);
});

test('the same seed gives identical text; a different seed reads differently', () => {
  const once = resolveDuel({ sides: castEqual, seed: 7, terrain: 'the Rusted Pass' }).narrative;
  const twice = resolveDuel({ sides: castEqual, seed: 7, terrain: 'the Rusted Pass' }).narrative;
  const other = resolveDuel({ sides: castEqual, seed: 1, terrain: 'the Rusted Pass' }).narrative;
  assert.equal(once, twice);
  assert.notEqual(once, other);
});

test('ability and Item names appear verbatim, with no template artefacts', () => {
  const kaelWins = resolveDuel({ sides: castEqual, seed: 7, terrain: 'the Rusted Pass' }).narrative;
  for (const name of ['Ashfall', 'The Long Count', 'Mirror Step', 'The Quiet Hour'])
    assert.ok(has(kaelWins, name), name);
  for (const name of ['a chipped sword', 'a boiled-leather shield']) assert.ok(has(kaelWins, name), name);

  const miraWins = resolveDuel({ sides: castEqual, seed: 1, terrain: 'the Rusted Pass' }).narrative;
  assert.ok(has(miraWins, 'a long grey blade'), 'the winner’s best offensive Item is named');

  for (const text of [kaelWins, miraWins]) {
    assert.doesNotMatch(text, /undefined|null|NaN|\[object|\{\{|\}\}|\$\{/);
    assert.doesNotMatch(text, / {2,}/);
    assert.doesNotMatch(text, / \./);
  }
});

test('Items with the same name are always tied to an owner', () => {
  const sameBlade = { A: [mira()], B: [vane()] };
  const text = resolveDuel({ sides: sameBlade, seed: 7, terrain: 'the Rusted Pass' }).narrative;
  assert.ok(has(text, 'a long grey blade'));
  assert.doesNotMatch(text, /same weapon/i);
  assert.match(text, /(Mira|Vane)[^.]*a long grey blade|a long grey blade[^.]*in (Mira|Vane)'s hands/);
});

test('every fighter in a team is named, and second abilities are used', () => {
  const text = resolveDuel({ sides: castTeams, seed: 7, terrain: 'the Rusted Pass' }).narrative;
  for (const name of ['Kael', 'Mira', 'Ren', 'Vane']) assert.ok(text.includes(name), name);
  for (const name of ['Ashfall', 'The Long Count', 'Mirror Step', 'The Quiet Hour', 'Nine Breaths', 'The Low Guard', 'Iron Verdict', 'The Slow Cut'])
    assert.ok(text.includes(name), name);
});

test('the ending always names resolveDuel’s winner', () => {
  const winnerName = { A: 'Kael', B: 'Mira' };
  for (const seed of [1, 7, 10, 42, 99]) {
    const result = resolveDuel({ sides: castEqual, seed, terrain: 'the Rusted Pass' });
    assert.ok(
      lastSentence(result.narrative).includes(winnerName[result.outcome.winnerSide]),
      `seed ${seed}: ${lastSentence(result.narrative)}`
    );
  }
});

test('masterful and ordinary wording appears only when a side was picked', () => {
  const marker =
    /without wasted motion|as though it were expected|every answer is already waiting|at their best|a beat behind|workmanlike|economically/;
  const plain = resolveDuel({ sides: castEqual, seed: 7, terrain: 'the Rusted Pass' });
  const skilled = resolveDuel({ sides: castEqual, seed: 7, terrain: 'the Rusted Pass', skilledSide: 'A' });
  assert.doesNotMatch(plain.narrative, marker);
  assert.match(skilled.narrative, marker);
  assert.equal(skilled.outcome.skillSide, 'A');
});

test('a chosen winner is narrated at its best and still given a real contest', () => {
  const result = resolveDuel({ sides: castPair, seed: 7, terrain: 'the flooded mill', chosenWinner: 'B' });
  assert.equal(result.outcome.winnerSide, 'B');
  assert.match(result.narrative, /at their best|remembered/);
  assert.ok(result.narrative.includes('The Long Count'), 'the losing side’s near-win uses its second ability');
  assert.ok(result.narrative.includes('The Low Guard'), 'both losing fighters get a moment');
  assert.ok(has(result.narrative, 'a long grey blade'), 'the chosen side’s best weapon is named');
  assert.ok(lastSentence(result.narrative).includes('Vane'));
});

test('terrain is woven into at least two beats, and empty terrain leaves no gaps', () => {
  const ground = resolveDuel({ sides: castEqual, seed: 7, terrain: 'the Rusted Pass' });
  assert.ok((ground.narrative.match(/the Rusted Pass/g) ?? []).length >= 2);

  for (const terrain of ['', '   ', 'Random']) {
    const bare = resolveDuel({ sides: castEqual, seed: 7, terrain });
    assert.doesNotMatch(bare.narrative, / {2,}| \.|undefined|null|Random/i);
    assert.ok(!bare.narrative.includes('neutral ground'));
  }
});

test('a dead fighter is handled as a memory without breaking the narrative', () => {
  const result = resolveDuel({ sides: { A: [kael({ dead: true })], B: [mira()] }, seed: 7, terrain: 'the Rusted Pass' });
  assert.match(result.narrative, /out of memory/);
  assert.ok(result.narrative.includes('Kael'));
  assert.doesNotMatch(result.narrative, /undefined|null/);
});

test('fighter point contributions add up for a spread of fighters', () => {
  const cases = [
    fighter({ powerRank: 0, abilities: [], items: [] }),
    fighter({ powerRank: 1, abilities: [ability(1)], items: [] }),
    fighter({ powerRank: 3, abilities: [ability(1), ability(2), ability(3)], items: [item(1, 'Hazardous')] }),
    fighter({
      powerRank: 2,
      abilities: [ability(1), ability(2), ability(3), ability(4)],
      items: [item(1, 'Singular', 'offense'), item(2, 'Desolating', 'defense')],
    }),
  ];

  for (const f of cases) {
    const part = scoreFighter(f);
    assert.equal(part.total, part.base + part.powerPoints + part.abilityPoints + part.attack + part.defence);
    assert.equal(part.powerPoints, part.power * 2);
    assert.equal(part.abilityPoints, Math.min(part.abilities, 3) * 1.5);
  }
});

test('side scores add up, with and without the skill multiplier', () => {
  for (const skilled of [false, true]) {
    for (const count of [1, 2, 3]) {
      const side = scoreSide(Array.from({ length: count }, () => fighter()), { skilled });
      assert.equal(side.multiplier, skilled ? 1.5 : 1);
      assert.equal(side.score, (side.raw + side.numbers) * side.multiplier);
      assert.equal(side.score, side.raw + side.numbers + (skilled ? (side.raw + side.numbers) * 0.5 : 0));
    }
  }
});

test('word count stays within 120-220 for 1v1, 2v1 and 2v2 across seeds', () => {
  for (const [label, sides] of [
    ['1v1', castEqual],
    ['2v1', castPair],
    ['2v2', castTeams],
  ]) {
    for (let seed = 1; seed <= 60; seed++) {
      const words = wordsOf(resolveDuel({ sides, seed, terrain: 'the Rusted Pass' }).narrative);
      assert.ok(words >= 120 && words <= 220, `${label} seed ${seed}: ${words} words`);
    }
  }
});

test('the narrative is a separate function and still reads without abilities or Items', () => {
  const bare = resolveDuel({
    sides: { A: [fighter({ characterId: 1, name: 'Kael', powerRank: 0 })], B: [fighter({ characterId: 2, name: 'Mira', powerRank: 0 })] },
    seed: 3,
  });
  assert.doesNotThrow(() =>
    buildNarrative({ sides: { A: [], B: [] }, outcome: { winnerSide: 'A' }, terrain: '', rng: mulberry32(1) })
  );
  assert.match(bare.narrative, /Kael/);
  assert.match(bare.narrative, /Mira/);
});

// ---------- side size ----------

const trioAbilityNames = [
  ['Ashfall', 'The Long Count'],
  ['Nine Breaths', 'The Low Guard'],
  ['Iron Verdict', 'The Slow Cut'],
  ['Mirror Step', 'The Quiet Hour'],
  ['Salt Wind', 'The Second Door'],
  ['Glass Hour', 'A Final Measure'],
];
const trioBlades = ['a chipped sword', 'a short knife', 'a long grey blade'];

const trioSide = (names, offset, itemBase) =>
  names.map((name, i) =>
    fighter({
      characterId: offset + i,
      name,
      dead: offset === 20 && i === 0,
      powerRank: (i % 4) + 1,
      abilities: trioAbilityNames[offset / 10 === 1 ? i : i + 3].map((abilityName) => ({
        id: `${offset}-${abilityName}`,
        name: abilityName,
      })),
      items: [
        item(itemBase + i, ['Hazardous', 'Elusive', 'Desolating'][i], 'offense', trioBlades[i]),
        item(itemBase + 100 + i, 'Elusive', 'defense', 'a boiled-leather shield'),
      ],
    })
  );

const trio = {
  A: trioSide(['Kael', 'Ren', 'Vane'], 10, 110),
  B: trioSide(['Mira', 'Sable', 'Orin'], 20, 120),
};

test('a side may hold at most three fighters', () => {
  const four = {
    A: [1, 2, 3, 4].map((id) => fighter({ characterId: id })),
    B: [fighter({ characterId: 5 })],
  };
  assert.throws(() => resolveDuel({ sides: four, seed: 1 }), /at most 3 fighters/);

  const characters = [1, 2, 3, 4, 5].map((id) => ({ id, name: `C${id}`, fields: {} }));
  assert.throws(
    () => snapshotCombatants({ sides: four, characters, items: [] }),
    /at most 3 fighters/
  );
});

test('the word cap is 280 when a side has three fighters, 220 otherwise', () => {
  assert.equal(narrativeWordCap(trio), 280);
  assert.equal(narrativeWordCap({ A: trio.A, B: trio.B.slice(0, 2) }), 280);
  assert.equal(narrativeWordCap({ A: [fighter()], B: [fighter()] }), 220);
  assert.equal(narrativeWordCap({ A: [fighter(), fighter()], B: [fighter(), fighter()] }), 220);
});

test('a 3v3 duel stays inside the 280 cap and keeps the second ability across seeds', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const narrative = resolveDuel({ sides: trio, seed, terrain: 'the Rusted Pass', chosenWinner: 'A' })
      .narrative;
    const words = narrative.split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 120 && words <= 280, `seed ${seed}: ${words} words`);
    assert.match(narrative, /hold nothing back/, `seed ${seed}: second abilities were dropped`);
  }
});
