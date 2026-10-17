// Unit tests for the entity-merge policy. Run with `npm test`
// (node --test server/*.test.mjs). No database is touched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFields, newAliasList, repointReferences } from './entitymerge.mjs';

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

test('mergeFields treats the holders array like any other key', () => {
  const a = JSON.stringify({ owners: [1, 2] });
  const b = JSON.stringify({ owners: [3], boon: 'bright' });
  assert.deepEqual(mergeFields(a, b), { owners: [1, 2], boon: 'bright' });
  assert.deepEqual(mergeFields('{}', b), { owners: [3], boon: 'bright' });
});

test('mergeFields survives junk on either side', () => {
  assert.deepEqual(mergeFields('not json', JSON.stringify({ a: 1 })), { a: 1 });
  assert.deepEqual(mergeFields(JSON.stringify({ a: 1 }), 'also not json'), { a: 1 });
  assert.deepEqual(mergeFields('[1,2,3]', JSON.stringify({ a: 1 })), { a: 1 });
});

test('mergeFields never merges an array or scalar blob into the object', () => {
  assert.deepEqual(mergeFields(JSON.stringify({ a: 1 }), '"a string"'), { a: 1 });
});

// ---------- cross-reference repointing (merge step 5) ----------

test('repointReferences moves every absorbed holder onto the survivor and dedupes', () => {
  const { fields, touched, ownersRepointed } = repointReferences(
    { owners: [7, 9, 9] },
    { survivorId: 3, absorbedId: 9, selfId: 5 }
  );
  assert.deepEqual(fields, { owners: [7, 3] });
  assert.equal(touched, true);
  assert.equal(ownersRepointed, 1);
});

test('repointReferences keeps the survivor as the holder of anything else', () => {
  // selfId 5 is not the survivor, so the survivor stays in the list.
  const { fields } = repointReferences(
    { owners: [3, 9] },
    { survivorId: 3, absorbedId: 9, selfId: 5 }
  );
  assert.deepEqual(fields, { owners: [3] });
});

test('repointReferences drops a holder that would become the entity itself', () => {
  const { fields, touched } = repointReferences(
    { owners: [9] },
    { survivorId: 3, absorbedId: 9, selfId: 3 }
  );
  assert.deepEqual(fields, {});
  assert.equal(touched, true);
});

test('repointReferences also repoints the legacy single owner', () => {
  assert.deepEqual(repointReferences({ owner: 9 }, { survivorId: 3, absorbedId: 9, selfId: 1 }).fields, {
    owner: 3,
  });
  assert.deepEqual(repointReferences({ owner: 9 }, { survivorId: 3, absorbedId: 9, selfId: 3 }).fields, {});
});

test('repointReferences leaves unrelated fields and entities alone', () => {
  const { fields, touched, ownersRepointed } = repointReferences(
    { owners: [1], custom: 'note' },
    { survivorId: 3, absorbedId: 9, selfId: 5 }
  );
  assert.deepEqual(fields, { owners: [1], custom: 'note' });
  assert.equal(touched, false);
  assert.equal(ownersRepointed, 0);
});

test('repointReferences still repoints leader / operates_in / members', () => {
  const lead = repointReferences({ leader: 9 }, { survivorId: 3, absorbedId: 9, selfId: 5 });
  assert.deepEqual(lead.fields, { leader: 3 });
  assert.equal(lead.ownersRepointed, 0);

  const drop = repointReferences({ operates_in: 9 }, { survivorId: 3, absorbedId: 9, selfId: 3 });
  assert.deepEqual(drop.fields, {});

  const members = repointReferences(
    { members: [9, 4, 9] },
    { survivorId: 3, absorbedId: 9, selfId: 5 }
  );
  assert.deepEqual(members.fields, { members: [3, 4] });
});

test('repointReferences tolerates a junk or empty blob', () => {
  assert.deepEqual(repointReferences(null, { survivorId: 3, absorbedId: 9, selfId: 5 }), {
    fields: {},
    touched: false,
    ownersRepointed: 0,
  });
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
