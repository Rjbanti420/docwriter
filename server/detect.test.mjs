// The scanner decides what the writer is ever asked about, and a false positive in
// Review is the app's most visible failure — so its precision-first rules get tests
// of their own. These run on plain strings: no database, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, findLookalike, buildLookalikeIndex, normalizeKey, splitSentences } from './detect.mjs';

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

test('detect: an all-caps card the book knows still gets its mentions', () => {
  const { candidates, mentions } = run('ICA arrived at the gate. Later, ICA left.', {
    keys: new Map([['ica', 4]]),
  });
  assert.equal(candidates.length, 0);
  assert.equal(mentions.length, 2);
  assert.ok(mentions.every((m) => m.key === 'ica'));
});

test('detect: an unknown all-caps acronym is offered as a candidate', () => {
  const { candidates } = run('The ICA arrived. The ICA left.');
  const ica = candidates.find((c) => c.key === 'ica');
  assert.ok(ica, 'ICA should be detected');
  assert.equal(ica.display, 'ICA');
  assert.equal(ica.occurrences, 2);
});

test('detect: shouted all-caps prose is not treated as names', () => {
  // The real scanner loads the English dictionary; supply the one short word.
  const { candidates } = run('EVERYONE STOPPED AND STARED AT THE WALL.', {
    dict: new Set(['wall']),
  });
  assert.deepEqual(candidates, []);
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

test('findLookalike: the length index finds the same candidates', () => {
  const keys = new Map([
    ['kael', 1],
    ['kaela', 2],
    ['brynn', 3],
    ['brightwood hall', 4],
    ['muller', 5],
    ['müller', 6],
    ['abc', 7],
    ['kaelx', 8],
  ]);
  const index = buildLookalikeIndex(keys);
  assert.equal(findLookalike('kaela', keys, index), 2);
  assert.equal(findLookalike('muller', keys, index), 5);
  assert.equal(findLookalike('müller', keys, index), 6);
  assert.equal(findLookalike('brightwood hal', keys, index), 4);
  assert.equal(findLookalike('kaeli', keys, index), null, 'Kael and Kaela are still a tie');
  assert.equal(findLookalike('abcdefgh', keys, index), null, 'far lengths are never compared');
});

test('normalizeKey folds case, a leading article and a possessive', () => {
  assert.equal(normalizeKey('The Silver Order'), 'silver order');
  assert.equal(normalizeKey('Kael\u2019s'), 'kael');
  assert.equal(normalizeKey('  A  Blade '), 'blade');
});

test('normalizeKey keeps accented letters instead of dropping them', () => {
  assert.equal(normalizeKey('Zo\u00eb'), 'zo\u00eb');
  assert.equal(normalizeKey('M\u00fcller'), 'm\u00fcller');
  assert.equal(normalizeKey('\u00c9lise\u2019s'), '\u00e9lise');
});

test('detect: accented names are found and matched whole', () => {
  const { candidates } = run('Zo\u00eb met \u00c9lise. Bront\u00eb nodded. M\u00fcller waited.');
  const keys = candidates.map((c) => c.key);
  for (const key of ['zo\u00eb', '\u00e9lise', 'bront\u00eb', 'm\u00fcller']) {
    assert.ok(keys.includes(key), `${key} should be detected, got ${JSON.stringify(keys)}`);
  }
});

test('detect: an accented known name is a mention, not a new candidate', () => {
  const { candidates, mentions } = run('Zo\u00eb ran. Zo\u00eb fell.', { keys: new Map([['zo\u00eb', 7]]) });
  assert.equal(candidates.length, 0);
  assert.equal(mentions.length, 2);
});

test('splitSentences does not end a sentence at an abbreviation', () => {
  assert.equal(splitSentences('Mr. Grey arrived. He left.').length, 2);
  assert.equal(splitSentences('Kael ran. He left.').length, 2);
});
