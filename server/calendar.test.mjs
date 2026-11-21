import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addHours,
  advance,
  dayIndex,
  daysInMonth,
  daysInYear,
  detectFlashback,
  earthCalendar,
  extractAbsolute,
  extractRelative,
  formatDate,
  fromIndex,
  isLeap,
  seasonOn,
  seasonStartOnOrAfter,
  validateCalendar,
  walkChapters,
} from './calendar.mjs';

const earth = earthCalendar();

test('earth is twelve real months and a 365-day year, 366 in a leap year', () => {
  assert.equal(earth.months.length, 12);
  assert.equal(daysInMonth(earth, 1980, 1), 29);
  assert.equal(daysInMonth(earth, 1981, 1), 28);
  assert.equal(daysInYear(earth, 1981), 365);
  assert.equal(daysInYear(earth, 1980), 366);
  assert.equal(isLeap(earth, 1980), true);
  assert.equal(isLeap(earth, 1981), false);
});

test('a date round-trips through the absolute day index', () => {
  for (const date of [
    { year: 1, month: 0, day: 1 },
    { year: 1, month: 11, day: 31 },
    { year: 4, month: 1, day: 29 },
    { year: 812, month: 6, day: 4 },
  ]) {
    const index = dayIndex(earth, date);
    assert.deepEqual(fromIndex(earth, index), { ...date, hour: 0 }, `${formatDate(earth, date)}`);
  }
  const first = dayIndex(earth, { year: 1, month: 0, day: 1 });
  assert.equal(first, 0);
  assert.equal(dayIndex(earth, { year: 2, month: 0, day: 1 }), 365);
});

test('custom calendars have their own months, weeks, hours and leap day', () => {
  const cal = {
    ...earth,
    kind: 'custom',
    name: 'The Long Year',
    days_per_week: 5,
    hours_per_day: 10,
    daylight_hours: 6,
    start_year: 1980,
    leap_every: 3,
    leap_anchor: 1980,
    leap_month: 1,
    months: [
      { position: 0, name: 'Rise', days: 10 },
      { position: 1, name: 'Deep', days: 5 },
      { position: 2, name: 'Dusk', days: 8 },
    ],
    seasons: [],
  };
  assert.equal(daysInYear(cal, 1980), 24);
  assert.equal(daysInYear(cal, 1981), 23);
  assert.deepEqual(fromIndex(cal, 10), { year: 1980, month: 1, day: 1, hour: 0 });
  assert.deepEqual(fromIndex(cal, 23), { year: 1980, month: 2, day: 8, hour: 0 });
  assert.deepEqual(fromIndex(cal, 24), { year: 1981, month: 0, day: 1, hour: 0 });

  const late = { year: 1980, month: 2, day: 7, hour: 9 };
  assert.deepEqual(addHours(cal, late, 2), { year: 1980, month: 2, day: 8, hour: 1 });
  assert.deepEqual(advance(cal, late, { months: 1 }), { year: 1981, month: 0, day: 7, hour: 9 });
});

test('seasons are day ranges, may straddle months, and gaps are allowed', () => {
  const cal = {
    ...earth,
    months: [
      { position: 0, name: 'A', days: 10 },
      { position: 1, name: 'B', days: 10 },
    ],
    seasons: [
      { name: 'Wet', start_day: 2, days: 4 },
      { name: 'Dry', start_day: 12, days: 3 },
    ],
    leap_every: null,
  };
  assert.equal(seasonOn(cal, { year: 1, month: 0, day: 1 }), null);
  assert.equal(seasonOn(cal, { year: 1, month: 0, day: 3 }).name, 'Wet');
  assert.equal(seasonOn(cal, { year: 1, month: 0, day: 6 }).name, 'Wet');
  assert.equal(seasonOn(cal, { year: 1, month: 0, day: 8 }), null);
  assert.equal(seasonOn(cal, { year: 1, month: 1, day: 4 }).name, 'Dry');
  assert.deepEqual(seasonStartOnOrAfter(cal, { year: 1, month: 1, day: 9 }, 'Wet'), {
    year: 2,
    month: 0,
    day: 3,
    hour: 0,
  });
});

test('relative statements move the clock only when a unit is stated', () => {
  const deltas = (text) => extractRelative(text, earth).map((m) => m.delta);

  assert.deepEqual(deltas('A day later she returned.'), [{ days: 1 }]);
  assert.deepEqual(deltas('Three days later, the snow came.'), [{ days: 3 }]);
  assert.deepEqual(deltas('An hour later the bell rang.'), [{ hours: 1 }]);
  assert.deepEqual(deltas('They met a week later.'), [{ days: 7 }]);
  assert.deepEqual(deltas('Two months later the letter arrived.'), [{ months: 2 }]);
  assert.deepEqual(deltas('A year later, nothing had changed.'), [{ years: 1 }]);
  assert.deepEqual(deltas('The next morning he left.'), [{ days: 1 }]);
  assert.deepEqual(deltas('That evening she said nothing.'), [{}]);
  assert.deepEqual(deltas('Meanwhile, across the bay, it rained.'), [{}]);
  assert.deepEqual(deltas('The following winter was hard.'), [{ season: 'Winter' }]);

  // A duration is not a move.
  assert.deepEqual(deltas('They argued for three hours.'), []);
  assert.deepEqual(deltas('It rained all day.'), []);
});

test('absolute statements are compared against the calendar vocabulary', () => {
  const mentions = extractAbsolute('On the 3rd of March, in the year 812, the frost broke.', earth);
  assert.deepEqual(
    mentions.map((m) => [m.kind, m.value]),
    [
      ['month', { month: 2, day: 3 }],
      ['year', { year: 812 }],
    ]
  );
  const masked = extractRelative('The following winter was hard.', earth);
  assert.equal(masked.length, 1);
  assert.deepEqual(extractAbsolute('The following winter was hard.', earth, masked), []);
  assert.equal(extractAbsolute('On the 3rd of March she left.', earth).length, 1);
});

test('the clock walk stacks chapters with no time mention and moves the rest', () => {
  const cal = {
    ...earth,
    start_year: 800,
    months: [
      { position: 0, name: 'Frost', days: 10 },
      { position: 1, name: 'Thaw', days: 10 },
    ],
    seasons: [
      { name: 'Frost', start_day: 0, days: 10 },
      { name: 'Thaw', start_day: 10, days: 10 },
    ],
    leap_every: null,
  };
  const walked = walkChapters(cal, [
    { id: 1, sort_order: 0, text: 'A day later, she reached the gate.' },
    { id: 2, sort_order: 1, text: 'She waited.' },
    { id: 3, sort_order: 2, text: 'The next morning, it snowed.' },
    { id: 4, sort_order: 3, text: 'Five days ago this was a field.' },
    { id: 5, sort_order: 4, text: 'A long time ago, the river ran black.' },
  ]);
  assert.deepEqual(walked[0].clock, { year: 800, month: 0, day: 1, hour: 0 });
  assert.deepEqual(walked[0].end, { year: 800, month: 0, day: 2, hour: 0 });
  assert.deepEqual(walked[1].clock, { year: 800, month: 0, day: 2, hour: 0 });
  assert.deepEqual(walked[1].end, walked[1].clock);
  assert.deepEqual(walked[2].clock, { year: 800, month: 0, day: 2, hour: 0 });
  assert.deepEqual(walked[2].end, { year: 800, month: 0, day: 3, hour: 0 });
  assert.equal(walked[4].flashback, true);
  assert.equal(walked[4].clock, null);
});

test('a stated date that disagrees becomes a proposal, never a silent move', () => {
  const cal = {
    ...earth,
    start_year: 812,
    months: [
      { position: 0, name: 'Frost', days: 10 },
      { position: 1, name: 'Harvest', days: 10 },
    ],
    seasons: [
      { name: 'Frost', start_day: 0, days: 10 },
      { name: 'Harvest', start_day: 10, days: 10 },
    ],
    leap_every: null,
  };
  const walked = walkChapters(cal, [
    { id: 7, sort_order: 0, text: 'On the 3rd of Harvest she left.' },
  ]);
  assert.deepEqual(walked[0].clock, { year: 812, month: 0, day: 1, hour: 0 });
  assert.equal(walked[0].mismatches.length, 1);
  assert.equal(walked[0].mismatches[0].raw, '3rd of Harvest');
  assert.deepEqual(walked[0].mismatches[0].proposed, { year: 812, month: 1, day: 3, hour: 0 });
  // The clock itself did not jump.
  assert.deepEqual(walked[0].end, walked[0].clock);
});

test('a manual clock anchors the chapter and later chapters follow it', () => {
  const cal = {
    ...earth,
    start_year: 1,
    months: [
      { position: 0, name: 'One', days: 10 },
      { position: 1, name: 'Two', days: 10 },
    ],
    seasons: [],
    leap_every: null,
  };
  const walked = walkChapters(cal, [
    { id: 1, sort_order: 0, text: 'Nothing moves.' },
    { id: 2, sort_order: 1, manualClock: { year: 1, month: 1, day: 5, hour: 3 }, text: 'Two days later.' },
    { id: 3, sort_order: 2, text: 'Nothing moves.' },
  ]);
  assert.deepEqual(walked[1].clock, { year: 1, month: 1, day: 5, hour: 3 });
  assert.deepEqual(walked[1].end, { year: 1, month: 1, day: 7, hour: 3 });
  assert.deepEqual(walked[2].clock, { year: 1, month: 1, day: 7, hour: 3 });
});

test('validation refuses duplicate names, bad days and overlapping seasons', () => {
  const bad = {
    ...earth,
    months: [
      { position: 0, name: 'One', days: 10 },
      { position: 1, name: 'one', days: 0 },
    ],
    seasons: [
      { name: 'A', start_day: 0, days: 8 },
      { name: 'B', start_day: 5, days: 5 },
    ],
    leap_every: null,
  };
  const result = validateCalendar(bad);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /two months/.test(e)));
  assert.ok(result.errors.some((e) => /overlaps/.test(e)));
  assert.equal(validateCalendar(earth).ok, true);
});

test('strong flashback phrasing is detected, ordinary history is not', () => {
  assert.equal(detectFlashback('A long time ago, the river ran black.'), true);
  assert.equal(detectFlashback('She remembered the flashback.'), true);
  assert.equal(detectFlashback('Three years later she returned.'), false);
});

test('a season may wrap the year end, and Earth winter covers January', () => {
  // Earth winter starts in December and runs into the next year.
  assert.equal(seasonOn(earth, { year: 812, month: 0, day: 1, hour: 0 })?.name, 'Winter');
  assert.equal(seasonOn(earth, { year: 812, month: 1, day: 20, hour: 0 })?.name, 'Winter');
  assert.equal(seasonOn(earth, { year: 812, month: 2, day: 1, hour: 0 })?.name, 'Spring'); // winter gives way to spring
  assert.equal(seasonOn(earth, { year: 812, month: 11, day: 31, hour: 0 })?.name, 'Winter');
  assert.equal(seasonOn(earth, { year: 812, month: 6, day: 1, hour: 0 })?.name, 'Summer');

  const wrapping = {
    ...earth,
    months: [
      { position: 0, name: 'One', days: 10 },
      { position: 1, name: 'Two', days: 10 },
    ],
    leap_every: null,
    seasons: [{ name: 'Long Cold', weather: 'Snow.', start_day: 15, days: 10 }],
  };
  assert.equal(validateCalendar(wrapping).ok, true);
  assert.equal(seasonOn(wrapping, { year: 1, month: 0, day: 2, hour: 0 })?.name, 'Long Cold');
  assert.equal(seasonOn(wrapping, { year: 1, month: 1, day: 7, hour: 0 })?.name, 'Long Cold');
  assert.equal(seasonOn(wrapping, { year: 1, month: 1, day: 3, hour: 0 }), null);

  // A wrapping season that collides with a normal one is still refused.
  const overlapping = {
    ...wrapping,
    seasons: [
      { name: 'Long Cold', weather: 'Snow.', start_day: 15, days: 10 },
      { name: 'Wet', weather: 'Rain.', start_day: 0, days: 8 },
    ],
  };
  assert.ok(validateCalendar(overlapping).errors.some((error) => /overlaps/.test(error)));
});
