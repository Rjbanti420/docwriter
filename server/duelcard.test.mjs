// Pure display-label tests for the saved-duel card. The helper lives in src/ so
// the component and these tests share one implementation; Node 26 strips the
// types on import, so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateLabel,
  fighterAbilityLine,
  fighterBreakdownLine,
  joinNames,
  outcomeNotes,
  sideNames,
  sideTotalLine,
} from '../src/duelcard.ts';

const sides = {
  terrain: 'the Rusted Pass',
  A: [{ name: 'Kael' }, { name: 'Ren' }, { name: 'Vane' }],
  B: [{ name: 'Mira' }],
};

test('a fighter line adds up from the point contributions', () => {
  assert.equal(
    fighterBreakdownLine({
      name: 'Kael',
      total: 18,
      base: 10,
      power: 1,
      powerPoints: 2,
      abilities: 2,
      abilityPoints: 3,
      attack: 3,
      defence: 0,
    }),
    'Kael: base 10 + power 2 + abilities 3 + attack 3 + defence 0 = 18'
  );
});

test('a legacy fighter line derives the missing points instead of breaking', () => {
  assert.equal(
    fighterBreakdownLine({
      name: 'Kael',
      total: 18,
      base: 10,
      power: 1,
      abilities: 2,
      attack: 3,
      defence: 0,
    }),
    'Kael: base 10 + power 2 + abilities 3 + attack 3 + defence 0 = 18'
  );
});

test('a side line shows the numbers edge and the skill multiplier only when it applies', () => {
  assert.equal(
    sideTotalLine({ fighters: [], raw: 18, numbers: 0, skilled: false, multiplier: 1, score: 18 }),
    'raw 18 + numbers 0 = 18'
  );
  assert.equal(
    sideTotalLine({ fighters: [], raw: 17, numbers: 2, skilled: true, multiplier: 1.5, score: 28.5 }),
    '(raw 17 + numbers 2) × 1.5 = 28.5'
  );
  // Legacy record: no multiplier field, but the skilled flag is enough.
  assert.equal(
    sideTotalLine({ fighters: [], raw: 17, numbers: 2, skilled: true, score: 28.5 }),
    '(raw 17 + numbers 2) × 1.5 = 28.5'
  );
  assert.equal(sideTotalLine(undefined), '');
});

test('a chosen result says so and never shows a roll', () => {
  const notes = outcomeNotes(
    { winnerSide: 'A', chosenBy: 'A', skillSide: null, seed: 7, roll: 0.25, probabilityA: 0.5 },
    sides
  );
  assert.deepEqual(notes, ['Winner chosen by you — the scores are for comparison, not a roll.']);
  assert.doesNotMatch(notes.join(' '), /seed|chance|roll \d/i);
});

test('a rolled result shows the skill side, the chance, the seed and the roll', () => {
  assert.deepEqual(
    outcomeNotes(
      { winnerSide: 'A', chosenBy: null, skillSide: 'A', seed: 7, roll: 0.25, probabilityA: 0.5142857 },
      sides
    ),
    ['More skilled: Kael, Ren and Vane', 'Win chance for A: 51.4% · seed 7 · roll 0.2500']
  );
});

test('chosen abilities list in stored order, and a legacy record still reads', () => {
  assert.equal(
    fighterAbilityLine({
      abilities: [
        { id: 'a3', name: 'Third' },
        { id: 'a1', name: 'First' },
      ],
    }),
    'Third · First'
  );
  assert.equal(fighterAbilityLine({ abilities: [] }), '');
  assert.equal(fighterAbilityLine({}), '');
  assert.equal(fighterAbilityLine({ abilities: ['Old name'] }), 'Old name');
});

test('names and dates stay readable', () => {
  assert.equal(joinNames([]), '');
  assert.equal(joinNames(['Kael']), 'Kael');
  assert.equal(joinNames(['Kael', 'Ren']), 'Kael and Ren');
  assert.equal(sideNames(sides, 'A'), 'Kael, Ren and Vane');
  assert.equal(dateLabel('2026-10-21 08:28:56'), '2026-10-21');
});
