// Unit tests for the export-reminder policy. Run with `npm test`
// (node --test server/*.test.mjs). No database is touched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isNudgeDue, NUDGE_FREQUENCIES } from './nudge.mjs';

const due = (patch) =>
  isNudgeDue({ nudge: 'daily', lastExportAt: null, lastNudgedOn: null, today: '2026-10-18', ...patch });

test('a book that has never been exported is due', () => {
  assert.equal(due({}), true);
});

test('daily waits for the calendar day to turn, not 24 hours', () => {
  assert.equal(due({ lastExportAt: '2026-10-18' }), false);
  assert.equal(due({ lastExportAt: '2026-10-17' }), true);
});

test('weekly and monthly are 7 and 30 calendar days', () => {
  assert.equal(due({ nudge: 'weekly', lastExportAt: '2026-10-12' }), false); // 6 days
  assert.equal(due({ nudge: 'weekly', lastExportAt: '2026-10-11' }), true); // 7 days
  assert.equal(due({ nudge: 'monthly', lastExportAt: '2026-09-19' }), false);
  assert.equal(due({ nudge: 'monthly', lastExportAt: '2026-09-18' }), true);
});

test('dismissing counts as satisfying the period, whichever came last', () => {
  // Exported a month ago, but dismissed yesterday: nothing to say yet.
  assert.equal(due({ nudge: 'weekly', lastExportAt: '2026-09-01', lastNudgedOn: '2026-10-17' }), false);
  // The mirror image: an old dismissal does not hold back a weekly reminder.
  assert.equal(due({ nudge: 'weekly', lastExportAt: '2026-10-17', lastNudgedOn: '2026-08-01' }), false);
});

test('off never reminds, and an unknown value is treated as off', () => {
  assert.equal(due({ nudge: 'off' }), false);
  assert.equal(due({ nudge: 'hourly' }), false);
  assert.deepEqual(NUDGE_FREQUENCIES, ['off', 'daily', 'weekly', 'monthly']);
});

test('a corrupt stored date reminds rather than staying silent forever', () => {
  assert.equal(due({ lastExportAt: 'yesterday' }), true);
});
