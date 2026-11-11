// Pure builder rules, imported straight from the TypeScript module. Node's
// built-in type stripping means this needs no build step and no UI framework.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ABILITIES,
  MAX_FIGHTERS_PER_SIDE,
  TERRAIN_FALLBACK,
  addFighter,
  buildDuelPayload,
  emptyBuilderState,
  itemSharedOnSide,
  itemUsedByOtherSide,
  missingForDuel,
  pickTerrain,
  pruneBuilder,
  readableServerError,
  removeFighter,
  resolveOutcome,
  setCustomTerrain,
  setTerrainMode,
  terrainText,
  toggleAbility,
  toggleItem,
  withRandomTerrain,
} from '../src/duelbuilder.ts';

const inventory = [
  { id: 1, abilityIds: ['a1', 'a2', 'a3', 'a4'], itemIds: [10, 11] },
  { id: 2, abilityIds: ['b1', 'b2'], itemIds: [10, 12] },
  { id: 3, abilityIds: [], itemIds: [] },
];

test('addFighter adds empty loadouts and refuses a fourth or a duplicate', () => {
  let state = emptyBuilderState();
  for (const id of [1, 2, 3]) state = addFighter(state, 'A', id);
  assert.equal(state.sides.A.length, MAX_FIGHTERS_PER_SIDE);
  assert.deepEqual(state.sides.A[0], { characterId: 1, abilityIds: [], itemIds: [] });
  assert.throws(() => addFighter(state, 'A', 4), /at most 3/);
  assert.throws(() => addFighter(state, 'B', 1), /already in the duel/);
  state = addFighter(state, 'B', 4);
  assert.deepEqual(state.sides.B.map((f) => f.characterId), [4]);
});

test('removeFighter removes only the requested seat', () => {
  let state = addFighter(addFighter(emptyBuilderState(), 'A', 1), 'A', 2);
  state = removeFighter(state, 'A', 1);
  assert.deepEqual(state.sides.A.map((f) => f.characterId), [2]);
  assert.equal(removeFighter(state, 'A', 99), state);
});

test('abilities cap at three and can be unticked', () => {
  let state = addFighter(emptyBuilderState(), 'A', 1);
  for (const id of ['a1', 'a2', 'a3', 'a4']) state = toggleAbility(state, 'A', 1, id);
  assert.deepEqual(state.sides.A[0].abilityIds, ['a1', 'a2', 'a3']);
  state = toggleAbility(state, 'A', 1, 'a2');
  assert.deepEqual(state.sides.A[0].abilityIds, ['a1', 'a3']);
  state = toggleAbility(state, 'A', 1, 'a4');
  assert.deepEqual(state.sides.A[0].abilityIds, ['a1', 'a3', 'a4']);
  assert.equal(MAX_ABILITIES, 3);
});

test('the same Item is blocked across sides, allowed and flagged within one side', () => {
  let state = addFighter(addFighter(addFighter(emptyBuilderState(), 'A', 1), 'A', 2), 'B', 3);
  state = toggleItem(state, 'A', 1, 10);
  assert.equal(itemUsedByOtherSide(state, 'B', 10), true);
  assert.equal(itemSharedOnSide(state, 'A', 10, 2), true);
  assert.equal(itemSharedOnSide(state, 'A', 10, 1), false);
  const blocked = toggleItem(state, 'B', 3, 10);
  assert.equal(blocked, state);
  state = toggleItem(state, 'A', 2, 10);
  assert.deepEqual(state.sides.A[1].itemIds, [10]);
  state = toggleItem(state, 'A', 1, 10);
  assert.equal(itemUsedByOtherSide(state, 'B', 10), true);
  state = toggleItem(state, 'A', 2, 10);
  assert.equal(itemUsedByOtherSide(state, 'B', 10), false);
});

test('pruneBuilder drops missing characters, abilities and Items; no-op keeps the state', () => {
  let state = addFighter(addFighter(emptyBuilderState(), 'A', 1), 'B', 2);
  state = toggleAbility(state, 'A', 1, 'a1');
  state = toggleAbility(state, 'A', 1, 'gone');
  state = toggleItem(state, 'A', 1, 10);
  state = toggleItem(state, 'A', 1, 99);

  const pruned = pruneBuilder(state, inventory);
  assert.deepEqual(pruned.sides.A[0].abilityIds, ['a1']);
  assert.deepEqual(pruned.sides.A[0].itemIds, [10]);
  assert.equal(pruneBuilder(pruned, inventory), pruned);

  const withoutKael = pruneBuilder(pruned, inventory.filter((c) => c.id !== 1));
  assert.deepEqual(withoutKael.sides.A, []);
  assert.deepEqual(withoutKael.sides.B.map((f) => f.characterId), [2]);
});

test('terrain is picked from Locations, falls back, and accepts a seeded source', () => {
  assert.equal(pickTerrain(['Hall', 'Bridge'], () => 0), 'Hall');
  assert.equal(pickTerrain(['Hall', 'Bridge'], () => 0.999999), 'Bridge');
  assert.equal(pickTerrain([], () => 0), TERRAIN_FALLBACK[0]);
  assert.equal(pickTerrain(['', '  '], () => 0), TERRAIN_FALLBACK[0]);
  assert.equal(pickTerrain(['Hall'], () => 1), 'Hall');
  let n = 0;
  const seeded = () => (n++ === 0 ? 0.9 : 0.1);
  assert.equal(pickTerrain(['A', 'B'], seeded), 'B');
  assert.equal(pickTerrain(['A', 'B'], seeded), 'A');
});

test('custom terrain is capped and trimmed; Random keeps its picked name', () => {
  const state = withRandomTerrain(emptyBuilderState(), ['The Pass'], () => 0);
  assert.equal(terrainText(state), 'The Pass');
  const custom = setCustomTerrain(state, 'x'.repeat(100));
  assert.equal(custom.terrain.custom.length, 80);
  assert.equal(terrainText(custom).length, 80);
  assert.equal(terrainText(setCustomTerrain(state, '  hello  ')), 'hello');
  assert.equal(terrainText(setCustomTerrain(state, '   ')), '');
  assert.equal(terrainText(setTerrainMode(custom, 'random')), 'The Pass');
});

test('the two popup answers map to exactly five outcomes', () => {
  assert.deepEqual(resolveOutcome('A'), { chosenWinner: 'A', skilledSide: null });
  assert.deepEqual(resolveOutcome('B', 'A'), { chosenWinner: 'B', skilledSide: null });
  assert.deepEqual(resolveOutcome('none', 'A'), { chosenWinner: null, skilledSide: 'A' });
  assert.deepEqual(resolveOutcome('none', 'B'), { chosenWinner: null, skilledSide: 'B' });
  assert.deepEqual(resolveOutcome('none', 'neither'), { chosenWinner: null, skilledSide: null });
});

test('a route error shows its sentence without the status envelope', () => {
  assert.equal(
    readableServerError(new Error('400 Bad Request {"error":"item 8 is missing or in Trash"}')),
    'item 8 is missing or in Trash'
  );
  assert.equal(
    readableServerError(new Error('500 Internal Server Error')),
    '500 Internal Server Error'
  );
  assert.equal(readableServerError('offline'), 'offline');
});

test('a route error substitutes the Item or ability name the builder knows', () => {
  const names = {
    items: new Map([[8, 'a chipped sword']]),
    abilities: new Map([['k9', 'Ashfall']]),
  };
  assert.equal(
    readableServerError(new Error('400 Bad Request {"error":"item 8 is missing or in Trash"}'), names),
    "'a chipped sword' is missing or in Trash"
  );
  assert.equal(
    readableServerError(new Error('400 Bad Request {"error":"ability k9 does not belong to Kael"}'), names),
    "ability 'Ashfall' does not belong to Kael"
  );
  assert.equal(
    readableServerError(new Error('400 Bad Request {"error":"item 99 is missing or in Trash"}'), names),
    'item 99 is missing or in Trash'
  );
  assert.equal(
    readableServerError(new Error('400 Bad Request {"error":"ability nope does not belong to Kael"}'), names),
    'ability nope does not belong to Kael'
  );
});

test('missingForDuel names each empty side', () => {
  let state = emptyBuilderState();
  assert.deepEqual(missingForDuel(state), ['Side A needs a fighter', 'Side B needs a fighter']);
  state = addFighter(state, 'A', 1);
  assert.deepEqual(missingForDuel(state), ['Side B needs a fighter']);
  state = addFighter(state, 'B', 2);
  assert.deepEqual(missingForDuel(state), []);
});

test('buildDuelPayload emits the exact POST shape and normalizes chosen skill', () => {
  let state = addFighter(addFighter(emptyBuilderState('The Pass'), 'A', 1), 'B', 2);
  state = toggleAbility(state, 'A', 1, 'a1');
  state = toggleAbility(state, 'B', 2, 'b2');
  state = toggleItem(state, 'A', 1, 10);
  state = toggleItem(state, 'B', 2, 12);
  state = { ...state, chosenWinner: 'A', skilledSide: 'B' };
  assert.deepEqual(buildDuelPayload(state), {
    sides: [
      { fighters: [{ characterId: 1, abilityIds: ['a1'], itemIds: [10] }] },
      { fighters: [{ characterId: 2, abilityIds: ['b2'], itemIds: [12] }] },
    ],
    terrain: 'The Pass',
    chosenWinner: 'A',
    skilledSide: null,
  });
});

test('the payload allows one Item on two fighters of the same side', () => {
  let state = addFighter(addFighter(addFighter(emptyBuilderState('x'), 'A', 1), 'A', 2), 'B', 3);
  state = toggleItem(state, 'A', 1, 10);
  state = toggleItem(state, 'A', 2, 10);
  const payload = buildDuelPayload(state);
  assert.deepEqual(
    payload.sides[0].fighters.map((fighter) => fighter.itemIds),
    [[10], [10]]
  );
});

test('buildDuelPayload rejects states the server would reject', () => {
  assert.throws(() => buildDuelPayload(emptyBuilderState()), /1 to 3 fighters/);
  let state = addFighter(emptyBuilderState(), 'A', 1);
  assert.throws(() => buildDuelPayload(state), /1 to 3 fighters/);

  state = addFighter(addFighter(emptyBuilderState(), 'A', 1), 'B', 2);
  const duplicate = { ...state, sides: { ...state.sides, A: [...state.sides.A, { ...state.sides.A[0] }] } };
  assert.throws(() => buildDuelPayload(duplicate), /twice/);

  const tooManyAbilities = {
    ...state,
    sides: {
      ...state.sides,
      A: [{ ...state.sides.A[0], abilityIds: ['1', '2', '3', '4'] }],
    },
  };
  assert.throws(() => buildDuelPayload(tooManyAbilities), /at most 3 abilities/);

  let crossSide = addFighter(addFighter(emptyBuilderState(), 'A', 1), 'B', 2);
  crossSide = toggleItem(crossSide, 'A', 1, 10);
  crossSide = {
    ...crossSide,
    sides: { ...crossSide.sides, B: [{ ...crossSide.sides.B[0], itemIds: [10] }] },
  };
  assert.throws(() => buildDuelPayload(crossSide), /both sides/);
});
