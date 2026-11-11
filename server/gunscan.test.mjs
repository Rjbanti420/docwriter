import test from 'node:test';
import assert from 'node:assert/strict';
import { detectGunCandidates, normalizeGunTitle } from './gunscan.mjs';

test('normalizeGunTitle drops articles and possessives for global ignore', () => {
  assert.equal(normalizeGunTitle('The Brass Key'), 'brass key');
  assert.equal(normalizeGunTitle('His brass key'), 'brass key');
  assert.equal(normalizeGunTitle('the brass key'), 'brass key');
});

test('a rejected plural also suppresses its singular', () => {
  assert.equal(normalizeGunTitle('Weapons'), 'weapon');
  assert.equal(normalizeGunTitle('A weapon'), 'weapon');
  const text = 'A weapon appeared. Choose a weapon. [Choose a weapon or tool.]';
  assert.ok(detectGunCandidates(text).some((c) => c.normalized === 'weapon'));
  assert.equal(detectGunCandidates(text, { excluded: ['Weapons'] }).length, 0);
});

test('a handled, repeated object becomes a primary suggestion', () => {
  const text = [
    'Maren set the brass key on the table.',
    'The brass key was cold in her palm.',
    'She carried the brass key to the vault.',
  ].join('\n\n');
  const found = detectGunCandidates(text);
  const key = found.find((c) => c.normalized === 'brass key');
  assert.ok(key, 'the key was found');
  assert.equal(key.tier, 'primary');
  assert.ok(key.score >= 6);
  assert.ok(key.occurrences >= 2);
});

test('the same suggestion is skipped when ignored or already a gun', () => {
  const text = 'She carried the brass key. The brass key was cold.';
  assert.equal(detectGunCandidates(text, { excluded: ['brass key'] }).length, 0);
  assert.equal(detectGunCandidates(text, { existingGuns: ['The brass key in the market'] }).length, 0);
});

test('a known Item is a primary suggestion even from one mention', () => {
  const found = detectGunCandidates('The Brass Key hung beside the door.', {
    entities: [{ name: 'The Brass Key', typeName: 'Item' }],
  });
  assert.equal(found[0]?.normalized, 'brass key');
  assert.equal(found[0]?.tier, 'primary');
  assert.ok(found[0]?.signals.includes('known'));
});

test('a simile is not treated as a planted object', () => {
  const found = detectGunCandidates('The pain was like a blunt knife in her skull.');
  assert.ok(!found.some((c) => c.normalized.includes('knife')));
});

test('only two primaries surface; the rest wait behind Show more', () => {
  const text = [
    'She carried the brass key.',
    'The brass key was cold.',
    'He carried the silver locket.',
    'The silver locket was warm.',
    'They carried the iron compass.',
    'The iron compass was heavy.',
    'A copper coin lay on the table.',
    'The copper coin gleamed.',
  ].join('\n\n');
  const found = detectGunCandidates(text);
  assert.ok(found.filter((c) => c.tier === 'primary').length <= 2);
  assert.ok(found.some((c) => c.tier === 'more'));
});

test('a chapter with only weak objects gets no suggestion at all', () => {
  assert.deepEqual(detectGunCandidates('A paper lay on the table.'), []);
});

test('abstract nouns only surface with promise language', () => {
  const plain = detectGunCandidates('The secret was in the room.');
  assert.ok(!plain.some((c) => c.normalized === 'secret'));
  const promised = detectGunCandidates('She would remember the secret. The secret would return.');
  assert.ok(promised.some((c) => c.normalized === 'secret'));
});
