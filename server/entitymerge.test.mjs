// Unit tests for the entity-merge policy. Run with `npm test`
// (node --test server/*.test.mjs). No database is touched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFields, newAliasList } from './entitymerge.mjs';

// ---------- fields ----------

test('mergeFields lets B fill every blank the survivor leaves', () => {
  const a = JSON.stringify({ owner: 5 });
  const b = JSON.stringify({ image: 'data:image/png;base64,AAA', owner: 9, custom: 'note' });
  assert.deepEqual(mergeFields(a, b), {
    owner: 5, // A's opinion survives untouched
    image: 'data:image/png;base64,AAA',
    custom: 'note', // B's extras are carried over
  });
});

test('mergeFields is a straight union when the survivor has nothing', () => {
  const b = JSON.stringify({ death: { chapter: 3, at: 'x' }, image: 'y' });
  assert.deepEqual(mergeFields('{}', b), { death: { chapter: 3, at: 'x' }, image: 'y' });
});

test('mergeFields survives junk on either side', () => {
  assert.deepEqual(mergeFields('not json', JSON.stringify({ a: 1 })), { a: 1 });
  assert.deepEqual(mergeFields(JSON.stringify({ a: 1 }), 'also not json'), { a: 1 });
  assert.deepEqual(mergeFields('[1,2,3]', JSON.stringify({ a: 1 })), { a: 1 });
});

test('mergeFields never merges an array or scalar blob into the object', () => {
  assert.deepEqual(mergeFields(JSON.stringify({ a: 1 }), '"a string"'), { a: 1 });
});

// ---------- aliases ----------

test('newAliasList takes the absorbed name and its aliases, deduped', () => {
  assert.deepEqual(
    newAliasList('Kael', ['TheCaptain'], 'Kael the Bold', ['Sir Kael', 'Kaelth Bold']),
    ['Kael the Bold', 'Sir Kael', 'Kaelth Bold']
  );
});

test('newAliasList skips spellings the survivor already owns', () => {
  // Absorbed name matches the survivor (different case), and one of its
  // aliases is already on the survivor — neither should be re-added.
  assert.deepEqual(newAliasList('Kael', ['Sir Kael'], 'kael', ['Sir Kael', 'Kael the Bold']), [
    'Kael the Bold',
  ]);
});

test('newAliasList dedupes within B itself', () => {
  // Two absorbed names that normalise to the same key come back once.
  assert.deepEqual(newAliasList('Marla', [], 'the Black Keep', ['black keep']), ['the Black Keep']);
});

test('newAliasList drops blanks and punctuation-only names', () => {
  assert.deepEqual(newAliasList('Kael', [], '   ', ['!!!']), []);
});

test('newAliasList ignores junk arrays and missing names', () => {
  assert.deepEqual(newAliasList('Kael', null, 'Kael the Bold', undefined), ['Kael the Bold']);
});
