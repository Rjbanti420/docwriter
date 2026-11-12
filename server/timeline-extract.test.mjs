import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEventCandidates } from './timeline-extract.mjs';

test('event candidates need an explicit time cue', () => {
  assert.equal(extractEventCandidates('Mara drew her sword and waited.').length, 0);
  const dated = extractEventCandidates('In 1204 the siege ended.');
  assert.equal(dated.length, 1);
  assert.equal(dated[0].story_time, 'In 1204');
  assert.equal(dated[0].title, 'In 1204 the siege ended.');
});

test('relative time phrases are proposed with the phrase as story time', () => {
  const [candidate] = extractEventCandidates('Three years later, Mara returned to the keep.');
  assert.equal(candidate.story_time, 'Three years later');
  assert.equal(candidate.summary, 'Three years later, Mara returned to the keep.');

  assert.equal(extractEventCandidates('The next morning she left.').length, 1);
  assert.equal(extractEventCandidates('They met at dusk.').length, 1);
});

test('questions, fragments and repeated sentences are dropped', () => {
  assert.equal(extractEventCandidates('Why did she leave that night?').length, 0);
  assert.equal(extractEventCandidates('That night.').length, 0);
  const twice = extractEventCandidates('That night the tower burned. That night the tower burned.');
  assert.equal(twice.length, 1);
});

test('a long sentence is shortened at a word boundary', () => {
  const [candidate] = extractEventCandidates(
    'In the year 1204, after the long siege that had lasted through three winters and cost the keep most of its stores, the gates finally opened to the returning army.'
  );
  assert.ok(candidate.title.length <= 120);
  assert.ok(candidate.title.endsWith('…'));
  assert.ok(!candidate.title.includes('  '));
  assert.equal(candidate.summary, candidate.sentence);
});

test('blank text proposes nothing', () => {
  assert.deepEqual(extractEventCandidates(''), []);
  assert.deepEqual(extractEventCandidates('   \n  '), []);
});
