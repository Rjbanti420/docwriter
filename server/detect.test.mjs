// The scanner decides what the writer is ever asked about, and a false positive in
// Review is the app's most visible failure — so its precision-first rules get tests
// of their own. These run on plain strings: no database, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, findLookalike, normalizeKey, splitSentences } from './detect.mjs';

function run(text, { keys = new Map(), ignored = new Set(), dict = new Set() } = {}) {
  return detect(text, keys, ignored, dict);
}

test('detect: a name used mid-sentence is a primary candidate', () => {
  const { candidates } = run('Kael drew the blade. The blade hummed in Kael\u2019s hand.');
  const kael = candidates.find((c) => c.key === 'kael');
  assert.ok(kael, 'Kael should be detected');
  assert.equal(kael.tier, 'primary');
  assert.equal(kael.suggestedType, 'Character');
  assert.equal(kael.occurrences, 2);
});

test('detect: a name the book already knows becomes a mention, not a candidate', () => {
  const { candidates, mentions } = run('Kael ran. Kael fell.', { keys: new Map([['kael', 7]]) });
  assert.equal(candidates.length, 0);
  assert.equal(mentions.length, 2);
  assert.deepEqual([...new Set(mentions.map((m) => m.key))], ['kael']);
});

test('detect: an ignored name never comes back', () => {
  const { candidates, mentions } = run('Brightwood Hall stood empty. Brightwood Hall again.', {
    ignored: new Set(['brightwood hall']),
  });
  assert.equal(candidates.length, 0);
  assert.equal(mentions.length, 0);
});

test('detect: a sentence-initial common word does not swallow the next name', () => {
  const { candidates } = run('Then Kael spoke. Then Kael left.');
  assert.ok(candidates.some((c) => c.key === 'kael'));
  assert.ok(!candidates.some((c) => c.key.includes('then')));
});

test('detect: a type keyword picks the suggested type', () => {
  const { candidates } = run('The Silver Order met at Grey Harbour.');
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  assert.equal(byKey.get('silver order')?.suggestedType, 'Organisation');
  assert.equal(byKey.get('grey harbour')?.suggestedType, 'Location');
});

test('findLookalike: a unique near-match is offered', () => {
  assert.equal(findLookalike('kaela', new Map([['kael', 1], ['brynn', 2]])), 1);
});

test('findLookalike: never guesses between two equally close entities', () => {
  // "Kael" is one edit from both: offering either one risks merging two real
  // characters into one, and a merge has no undo.
  assert.equal(findLookalike('kael', new Map([['kaela', 1], ['kaeli', 2]])), null);
});

test('findLookalike: two spellings of one entity are not ambiguous', () => {
  assert.equal(findLookalike('kael', new Map([['kaela', 1], ['kaelah', 1]])), 1);
});

test('findLookalike: short names are never suggested', () => {
  assert.equal(findLookalike('abi', new Map([['abi', 1], ['aida', 2]])), null);
});

test('normalizeKey folds case, a leading article and a possessive', () => {
  assert.equal(normalizeKey('The Silver Order'), 'silver order');
  assert.equal(normalizeKey('Kael\u2019s'), 'kael');
  assert.equal(normalizeKey('  A  Blade '), 'blade');
});

test('splitSentences does not end a sentence at an abbreviation', () => {
  assert.equal(splitSentences('Mr. Grey arrived. He left.').length, 2);
  assert.equal(splitSentences('Kael ran. He left.').length, 2);
});
