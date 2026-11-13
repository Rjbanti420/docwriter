// Unit tests for the pure planning logic. Run with `npm test`
// (node --test server/*.test.mjs). No database is touched.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveNumber,
  chapterLabel,
  resolvePlanned,
  isGunSettled,
  isGunReady,
  incrementNumber,
  gunDecide,
  gunReopen,
  sortGuns,
  questionStatus,
  normalizeQuestion,
  detectQuestions,
  dedupeQuestions,
} from './planning.mjs';

const ch = (id, number, sort_order = 0, title = '') => ({ id, number, sort_order, title });

// ---------- chapters ----------

test('effectiveNumber falls back to position when number is blank', () => {
  assert.equal(effectiveNumber(ch(1, '12', 11)), '12');
  assert.equal(effectiveNumber(ch(2, '  7 ', 6)), '7');
  assert.equal(effectiveNumber(ch(3, '', 4)), '5');
  assert.equal(effectiveNumber(ch(4, '   ', 0)), '1');
});

test('chapterLabel reads "Ch N" and appends a title', () => {
  assert.equal(chapterLabel(ch(1, '12', 11)), 'Ch 12');
  assert.equal(chapterLabel(ch(2, '12', 11, 'The Gate')), 'Ch 12 — The Gate');
  assert.equal(chapterLabel(null), '');
});

// ---------- notification trigger ----------

test('isGunReady fires only when the planned chapter exists', () => {
  const chapters = [ch(1, '1', 0), ch(2, '2', 1), ch(3, '3', 2)];
  const gun = { id: 1, planned_number: '3', status: 'active' };
  assert.equal(isGunReady(gun, chapters), true);

  assert.equal(isGunReady({ ...gun, planned_number: '9' }, chapters), false);
  assert.equal(isGunReady({ ...gun, planned_number: '' }, chapters), false);
  assert.equal(isGunReady({ ...gun, status: 'fired' }, chapters), false);
});

test('resolvePlanned returns the chapter row or null', () => {
  const chapters = [ch(1, '1', 0), ch(2, '2', 1)];
  assert.equal(resolvePlanned({ planned_number: '2' }, chapters)?.id, 2);
  assert.equal(resolvePlanned({ planned_number: '7' }, chapters), null);
  assert.equal(resolvePlanned({ planned_number: '' }, chapters), null);
});

test('resolvePlanned follows a linked chapter through a renumber', () => {
  // Linked to chapter 8 when it was "15"; it has since become "3".
  const renumbered = [ch(8, '3', 14), ch(9, '15', 15)];
  assert.equal(resolvePlanned({ planned_number: '15', planned_chapter_id: 8 }, renumbered)?.id, 8);
  // Deleting the linked chapter drops back to matching the intended number.
  assert.equal(resolvePlanned({ planned_number: '15', planned_chapter_id: 8 }, [ch(9, '15', 15)])?.id, 9);
  // No link yet: plain number matching, as before.
  assert.equal(resolvePlanned({ planned_number: '15' }, [ch(9, '15', 15)])?.id, 9);
});

test('isGunReady is true for a gun linked to a real chapter', () => {
  const chapters = [ch(8, '15', 14)];
  assert.equal(
    isGunReady({ id: 1, status: 'active', planned_number: '15', planned_chapter_id: 8 }, chapters),
    true,
  );
  assert.equal(
    isGunReady({ id: 1, status: 'active', planned_number: '15', planned_chapter_id: 8 }, []),
    false,
  );
});

test('incrementNumber advances digits and leaves non-numeric alone', () => {
  assert.equal(incrementNumber('14'), '15');
  assert.equal(incrementNumber(' 9 '), '10');
  assert.equal(incrementNumber('prologue'), '');
  assert.equal(incrementNumber(''), '');
});

// ---------- Discussed / Used shifting ----------

test('Used records the outcome and stops re-arming', () => {
  const gun = { id: 1, planned_number: '12', status: 'active', outcome: '' };
  const { gun: next, history } = gunDecide(gun, 'used', '', ch(12, '12', 11, 'The Gate'));
  assert.equal(next.outcome, 'used');
  assert.equal(next.planned_number, '12');
  assert.equal(next.planned_chapter_id, 12);
  assert.equal(history.decision, 'used');
  assert.equal(history.from_number, '12');
  assert.equal(history.to_number, '');
  assert.equal(history.chapter_id, 12);
  assert.equal(history.chapter_label, 'Ch 12 — The Gate');
});

test('Discussed shifts the plan forward and re-arms', () => {
  const gun = { id: 1, planned_number: '12', status: 'active', outcome: '' };
  const { gun: next, history } = gunDecide(gun, 'discussed', '', ch(12, '12', 11));
  assert.equal(next.outcome, 'discussed');
  assert.equal(next.planned_number, '13');
  assert.equal(next.planned_chapter_id, null);
  assert.equal(history.decision, 'discussed');
  assert.equal(history.from_number, '12');
  assert.equal(history.to_number, '13');
});

test('Discussed honours an explicit new number', () => {
  const gun = { id: 1, planned_number: '12', status: 'active' };
  const { gun: next, history } = gunDecide(gun, 'discussed', '18', ch(12, '12', 11));
  assert.equal(next.planned_number, '18');
  assert.equal(history.to_number, '18');
});

test('an unknown decision is treated as Discussed', () => {
  const gun = { id: 1, planned_number: '3', status: 'active' };
  assert.equal(gunDecide(gun, 'whatever', '', ch(3, '3', 2)).gun.outcome, 'discussed');
});

test('Discussed re-arms for the next chapter; Used settles the gun', () => {
  let gun = { id: 1, planned_number: '4', status: 'active', outcome: '' };
  const atFour = ch(4, '4', 3);
  assert.equal(isGunReady(gun, [atFour]), true);

  gun = gunDecide(gun, 'discussed', '', atFour).gun; // shifts to 5
  assert.equal(gun.planned_number, '5');
  assert.equal(isGunReady(gun, [atFour]), false, 'the old chapter no longer matches');

  const atFive = ch(5, '5', 4);
  assert.equal(isGunReady(gun, [atFour, atFive]), true, 're-armed for the new chapter');

  gun = gunDecide(gun, 'used', '', atFive).gun;
  assert.equal(gun.outcome, 'used');
  assert.equal(isGunReady(gun, [atFour, atFive]), false, 'Used settles the gun');

  gun = { ...gun, status: 'fired' };
  assert.equal(isGunReady(gun, [atFour, atFive]), false);
});

// ---------- reopening ----------

test('reopen clears a Used decision and re-arms the gun', () => {
  let gun = { id: 1, planned_number: '5', status: 'active', outcome: '' };
  const atFive = ch(5, '5', 4);
  assert.equal(isGunReady(gun, [atFive]), true);

  gun = gunDecide(gun, 'used', '', atFive).gun;
  assert.equal(gun.outcome, 'used');
  assert.equal(isGunReady(gun, [atFive]), false, 'Used stops the notifications');

  const { gun: next, history } = gunReopen(gun);
  assert.equal(next.outcome, null, 'reopen clears the outcome');
  assert.equal(isGunReady(next, [atFive]), true, 'reopen re-arms for the same chapter');
  assert.equal(history.decision, 'reopened');
  assert.equal(history.from_number, '5');
});

test('reopen leaves a fired gun closed for good', () => {
  // Fired is the permanent state: reopen only touches the outcome, so a fired
  // gun stays settled no matter what.
  const gun = { id: 1, planned_number: '5', status: 'fired', outcome: 'used', fired_at: '2026-01-01' };
  const { gun: next } = gunReopen(gun);
  assert.equal(next.outcome, null);
  assert.equal(next.status, 'fired', 'reopen does not undo the fire');
  assert.equal(isGunSettled(next), true, 'a fired gun is still settled after reopen');
});

test('isGunSettled treats Used as reversible and Fired as permanent', () => {
  assert.equal(isGunSettled({ id: 1, status: 'fired', outcome: '' }), true);
  assert.equal(isGunSettled({ id: 1, status: 'active', outcome: 'used' }), true, 'Used stops notifications');
  assert.equal(isGunSettled({ id: 1, status: 'active', outcome: 'discussed' }), false);
  assert.equal(isGunSettled({ id: 1, status: 'active', outcome: null }), false);
});

// ---------- sorting ----------

test('sortGuns orders by planned chapter and pushes fired guns last', () => {
  const guns = [
    { id: 1, planned_number: '20', status: 'active' },
    { id: 2, planned_number: '3', status: 'active' },
    { id: 3, planned_number: '9', status: 'fired' },
    { id: 4, planned_number: '11', status: 'active' },
    { id: 5, planned_number: '', status: 'active' },
  ];
  assert.deepEqual(sortGuns(guns).map((g) => g.id), [2, 4, 1, 5, 3]);
});

test('sortGuns orders numerics ascending then blanks, fired last', () => {
  const guns = [
    { id: 1, planned_number: '20', status: 'active' },
    { id: 2, planned_number: '11', status: 'active' },
    { id: 3, planned_number: '4', status: 'fired' },
    { id: 4, planned_number: '', status: 'active' },
  ];
  assert.deepEqual(sortGuns(guns).map((g) => g.id), [2, 1, 4, 3]);
});

// ---------- Questions ----------

test('questionStatus derives open / answered / delivered', () => {
  assert.equal(questionStatus({ answer: '', delivered_chapter_id: null }), 'open');
  assert.equal(questionStatus({ answer: 'Because.', delivered_chapter_id: null }), 'answered');
  assert.equal(questionStatus({ answer: '', delivered_chapter_id: 9 }), 'delivered');
  assert.equal(questionStatus({ answer: 'Because.', delivered_chapter_id: 9 }), 'delivered');
});

test('normalizeQuestion ignores case and punctuation', () => {
  assert.equal(normalizeQuestion('Who is the Gate-Keeper?'), 'who is the gate keeper');
  assert.equal(
    normalizeQuestion('who is the gate keeper'),
    normalizeQuestion('Who, is the Gate-Keeper?!'),
  );
});

test('detectQuestions picks question sentences, keeping dialogue quotes', () => {
  const text = 'He stopped. "Where is the key?" she asked. It rained all night. Who took it?';
  const found = detectQuestions(text).map((q) => q.text);
  assert.deepEqual(found, ['"Where is the key?"', 'Who took it?']);
});

test('detectQuestions dedups repeats within one chunk', () => {
  const text = 'Who took it? Later. Who took it?';
  assert.equal(detectQuestions(text).length, 1);
});

test('detectQuestions ignores statements and abbreviation periods', () => {
  const text = 'Mr. Hale arrived. The door opened.';
  assert.deepEqual(detectQuestions(text), []);
});

test('dedupeQuestions drops known and intra-batch duplicates', () => {
  const kept = dedupeQuestions(
    ['Who took it?', 'who took it', 'Where is the key?'],
    [normalizeQuestion('Where is the key?!')],
  );
  assert.deepEqual(kept.map((k) => k.text), ['Who took it?']);
  assert.equal(kept[0].normalized, 'who took it');
});
