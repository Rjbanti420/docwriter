// The calendar's maths, kept pure so the wizard, the clock walk and the tests
// all use one definition. Dates are { year, month, day, hour } with month
// 0-based and day 1-based, exactly as stored in the book.

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const NUMBER_WORDS = new Map(
  Object.entries({
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
    hundred: 100,
    couple: 2,
    few: 3,
    several: 3,
    many: 5,
  })
);

const COUNT = '(?:\\d{1,3}|a few|a couple of|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|couple|few|several|many)';

const PART_OF_DAY = '(?:morning|afternoon|evening|night|day)';

const HOLD_PATTERNS = [
  /\b(?:that|this|the same)\s+(?:morning|afternoon|evening|night)\b/gi,
  /\b(?:meanwhile|at the same time|simultaneously|later that day)\b/gi,
];

const SHORT_PATTERNS = [
  /\b(?:a|one|two|three|four|five|several|a few)\s+(?:moments?|seconds?|minutes?)\s+(?:later|after)\b/gi,
  /\b(?:moments?|seconds?|minutes?)\s+(?:later|after)\b/gi,
];

const RELATIVE_PATTERNS = [
  {
    unit: 'hours',
    re: new RegExp(`\\b(${COUNT})\\s+(?:hours?|hrs?)\\s+(?:later|afterwards?|after|on)\\b`, 'gi'),
  },
  {
    unit: 'days',
    re: new RegExp(`\\b(${COUNT})\\s+(?:days?|nights?)\\s+(?:later|afterwards?|after|on)\\b`, 'gi'),
  },
  {
    unit: 'weeks',
    re: new RegExp(`\\b(${COUNT})\\s+weeks?\\s+(?:later|afterwards?|after|on)\\b`, 'gi'),
  },
  {
    unit: 'months',
    re: new RegExp(`\\b(${COUNT})\\s+months?\\s+(?:later|afterwards?|after|on)\\b`, 'gi'),
  },
  {
    unit: 'years',
    re: new RegExp(`\\b(${COUNT})\\s+years?\\s+(?:later|afterwards?|after|on)\\b`, 'gi'),
  },
];

const NEXT_PATTERNS = [
  { unit: 'days', re: new RegExp(`\\b(?:the\\s+)?(?:next|following)\\s+${PART_OF_DAY}\\b`, 'gi') },
  { unit: 'weeks', re: /\b(?:the\s+)?(?:next|following)\s+week\b/gi },
  { unit: 'months', re: /\b(?:the\s+)?(?:next|following)\s+month\b/gi },
  { unit: 'years', re: /\b(?:the\s+)?(?:next|following)\s+year\b/gi },
];

const FLASHBACK = /\b(?:a long time ago|many years ago|years before|in the past|a flashback|flashback|before the story began)\b/i;

function countFrom(raw) {
  const text = String(raw ?? '').toLowerCase().trim();
  if (/^\d+$/.test(text)) return Number(text);
  return NUMBER_WORDS.get(text) ?? null;
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function earthCalendar() {
  return {
    name: 'Earth',
    kind: 'earth',
    hours_per_day: 24,
    daylight_hours: 12,
    days_per_week: 7,
    week_offset: 0,
    start_year: 1,
    era: 'CE',
    leap_every: 4,
    leap_month: 1,
    leap_anchor: 0,
    months: MONTH_NAMES.map((name, position) => ({
      position,
      name,
      days: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][position],
    })),
    // Day ranges are 0-based and approximate on purpose: in a leap year the
    // extra February day shifts everything after it by one, which is what a
    // season boundary does anyway.
    seasons: [
      { name: 'Spring', weather: 'Mild and wet; new growth after the last frost.', start_day: 59, days: 92 },
      { name: 'Summer', weather: 'Long, warm days; the driest stretch of the year.', start_day: 151, days: 92 },
      { name: 'Autumn', weather: 'Cooling, windy; the harvest and early rain.', start_day: 243, days: 91 },
      // Winter starts in December and wraps into January–February.
      { name: 'Winter', weather: 'Short, cold days; frost, snow and bare trees.', start_day: 334, days: 90 },
    ],
  };
}

export function isLeap(cal, year) {
  if (!cal?.leap_every) return false;
  const anchor = cal.leap_anchor ?? 0;
  return ((year - anchor) % cal.leap_every + cal.leap_every) % cal.leap_every === 0;
}

export function daysInMonth(cal, year, month) {
  const base = cal.months[month]?.days ?? 0;
  return base + (isLeap(cal, year) && month === cal.leap_month ? 1 : 0);
}

export function daysInYear(cal, year) {
  return cal.months.reduce((sum, month, index) => sum + daysInMonth(cal, year, index), 0);
}

/** Days from the calendar's first day to the first day of `year`. */
export function daysBeforeYear(cal, year) {
  let total = 0;
  if (year >= cal.start_year) {
    for (let y = cal.start_year; y < year; y += 1) total += daysInYear(cal, y);
  } else {
    for (let y = cal.start_year - 1; y >= year; y -= 1) total -= daysInYear(cal, y);
  }
  return total;
}

export function monthStartDay(cal, year, month) {
  let total = 0;
  for (let m = 0; m < month; m += 1) total += daysInMonth(cal, year, m);
  return total;
}

export function dayOfYear(cal, date) {
  return monthStartDay(cal, date.year, date.month) + (date.day - 1);
}

/** Absolute 0-based day number, derived — never stored. */
export function dayIndex(cal, date) {
  return daysBeforeYear(cal, date.year) + dayOfYear(cal, date);
}

export function fromIndex(cal, index) {
  let remaining = index;
  let year = cal.start_year;
  if (remaining >= 0) {
    while (remaining >= daysInYear(cal, year)) {
      remaining -= daysInYear(cal, year);
      year += 1;
    }
  } else {
    while (remaining < 0) {
      year -= 1;
      remaining += daysInYear(cal, year);
    }
  }
  let month = 0;
  while (month < cal.months.length - 1 && remaining >= daysInMonth(cal, year, month)) {
    remaining -= daysInMonth(cal, year, month);
    month += 1;
  }
  return { year, month, day: remaining + 1, hour: 0 };
}

export function clampDate(cal, date) {
  const year = Number.isInteger(date?.year) ? date.year : cal.start_year;
  const month = Math.min(Math.max(Number(date?.month) || 0, 0), cal.months.length - 1);
  const day = Math.min(Math.max(Number(date?.day) || 1, 1), daysInMonth(cal, year, month));
  const hour = Math.min(Math.max(Number(date?.hour) || 0, 0), cal.hours_per_day - 1);
  return { year, month, day, hour };
}

export function addDays(cal, date, days) {
  if (!days) return clampDate(cal, date);
  const next = fromIndex(cal, dayIndex(cal, date) + days);
  next.hour = Math.min(Math.max(date.hour ?? 0, 0), cal.hours_per_day - 1);
  return next;
}

export function addHours(cal, date, hours) {
  const total = (date.hour ?? 0) + hours;
  const dayShift = Math.floor(total / cal.hours_per_day);
  const hour = ((total % cal.hours_per_day) + cal.hours_per_day) % cal.hours_per_day;
  const next = addDays(cal, date, dayShift);
  next.hour = hour;
  return next;
}

export function addMonths(cal, date, months) {
  const count = cal.months.length;
  const total = (date.year - cal.start_year) * count + date.month + months;
  const year = cal.start_year + Math.floor(total / count);
  const month = ((total % count) + count) % count;
  const day = Math.min(date.day, daysInMonth(cal, year, month));
  return { year, month, day, hour: date.hour ?? 0 };
}

export function addYears(cal, date, years) {
  const year = date.year + years;
  const day = Math.min(date.day, daysInMonth(cal, year, date.month));
  return { year, month: date.month, day, hour: date.hour ?? 0 };
}

function baseYearDays(cal) {
  return cal.months.reduce((sum, month) => sum + month.days, 0);
}

export function seasonOn(cal, date) {
  const doy = dayOfYear(cal, date);
  const base = baseYearDays(cal);
  return (
    cal.seasons.find((season) => {
      const end = season.start_day + season.days;
      if (end <= base) return doy >= season.start_day && doy < end;
      // A season may wrap the year end: December into January and February.
      return doy >= season.start_day || doy < end - base;
    }) ?? null
  );
}

/** The first day of `name` at or after `date`, or null when no such season. */
export function seasonStartOnOrAfter(cal, date, name) {
  const season = cal.seasons.find((item) => item.name.toLowerCase() === String(name).toLowerCase());
  if (!season) return null;
  const start = fromIndex(cal, daysBeforeYear(cal, date.year) + season.start_day);
  if (dayIndex(cal, start) >= dayIndex(cal, date)) return { ...start, hour: 0 };
  const next = fromIndex(cal, daysBeforeYear(cal, date.year + 1) + season.start_day);
  return { ...next, hour: 0 };
}

export function jumpToSeason(cal, date, name) {
  const season = cal.seasons.find((item) => item.name.toLowerCase() === String(name).toLowerCase());
  if (!season) return clampDate(cal, date);
  // "The following winter" while already in winter means next winter.
  const start = fromIndex(cal, daysBeforeYear(cal, date.year) + season.start_day);
  if (dayIndex(cal, start) > dayIndex(cal, date)) return { ...start, hour: 0 };
  const next = fromIndex(cal, daysBeforeYear(cal, date.year + 1) + season.start_day);
  return { ...next, hour: 0 };
}

export function advance(cal, date, delta = {}) {
  let next = clampDate(cal, date);
  if (delta.years) next = addYears(cal, next, delta.years);
  if (delta.months) next = addMonths(cal, next, delta.months);
  if (delta.season) next = jumpToSeason(cal, next, delta.season);
  if (delta.days) next = addDays(cal, next, delta.days);
  if (delta.hours) next = addHours(cal, next, delta.hours);
  return next;
}

export function formatDate(cal, date, { hour = false } = {}) {
  if (!date) return '';
  const name = cal.months[date.month]?.name ?? `Month ${date.month + 1}`;
  const era = cal.era ? ` ${cal.era}` : '';
  const time = hour ? `, ${String(date.hour ?? 0).padStart(2, '0')}:00` : '';
  return `${date.day} ${name} ${date.year}${era}${time}`;
}

function overlaps(spans, start, end) {
  return spans.some((span) => start < span.end && end > span.start);
}

/** Relative time statements, in reading order. */
export function extractRelative(text, cal) {
  const source = String(text ?? '');
  if (!source) return [];
  const found = [];
  const push = (start, end, raw, delta, label) => {
    if (overlaps(found, start, end)) return;
    found.push({ start, end, raw, kind: 'relative', delta, label });
  };

  for (const pattern of RELATIVE_PATTERNS) {
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(source))) {
      const count = countFrom(match[1]);
      if (!count) continue;
      const delta =
        pattern.unit === 'hours'
          ? { hours: count }
          : pattern.unit === 'days'
            ? { days: count }
            : pattern.unit === 'weeks'
              ? { days: count * (cal.days_per_week || 7) }
              : pattern.unit === 'months'
                ? { months: count }
                : { years: count };
      const label =
        pattern.unit === 'hours'
          ? `${count} hour${count === 1 ? '' : 's'}`
          : pattern.unit === 'days'
            ? `${count} day${count === 1 ? '' : 's'}`
            : pattern.unit === 'weeks'
              ? `${count} week${count === 1 ? '' : 's'}`
              : pattern.unit === 'months'
                ? `${count} month${count === 1 ? '' : 's'}`
                : `${count} year${count === 1 ? '' : 's'}`;
      push(match.index, match.index + match[0].length, match[0], delta, label);
    }
  }

  for (const pattern of NEXT_PATTERNS) {
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(source))) {
      const delta =
        pattern.unit === 'days'
          ? { days: 1 }
          : pattern.unit === 'weeks'
            ? { days: cal.days_per_week || 7 }
            : pattern.unit === 'months'
              ? { months: 1 }
              : { years: 1 };
      push(match.index, match.index + match[0].length, match[0], delta, match[0].trim());
    }
  }

  // "The following winter" is relative only for a season the calendar knows.
  for (const season of cal.seasons ?? []) {
    const re = new RegExp(`\\b(?:the\\s+)?(?:next|following)\\s+${escapeRe(season.name)}\\b`, 'gi');
    let match;
    while ((match = re.exec(source))) {
      push(match.index, match.index + match[0].length, match[0], { season: season.name }, match[0].trim());
    }
  }

  for (const re of HOLD_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source))) {
      push(match.index, match.index + match[0].length, match[0], {}, match[0].trim());
    }
  }
  for (const re of SHORT_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source))) {
      push(match.index, match.index + match[0].length, match[0], {}, match[0].trim());
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

/**
 * Absolute date statements, ignoring any span already claimed by a relative
 * phrase ("the following winter" must not also read as "in winter").
 */
export function extractAbsolute(text, cal, skip = []) {
  const source = String(text ?? '');
  if (!source) return [];
  const found = [];
  const push = (start, end, raw, kind, value) => {
    if (overlaps(skip, start, end) || overlaps(found, start, end)) return;
    found.push({ start, end, raw, kind, value });
  };

  for (const [month, definition] of cal.months.entries()) {
    const name = escapeRe(definition.name);
    const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${name}\\b`, 'gi');
    const monthFirst = new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi');
    for (const re of [dayFirst, monthFirst]) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(source))) {
        const day = Number(match[1]);
        if (day >= 1 && day <= daysInMonth(cal, cal.start_year, month)) {
          push(match.index, match.index + match[0].length, match[0], 'month', { month, day });
        }
      }
    }
  }

  for (const season of cal.seasons ?? []) {
    const re = new RegExp(
      `\\b(?:in|during|by|early|late|the|that|this)\\s+${escapeRe(season.name)}\\b`,
      'gi'
    );
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source))) {
      push(match.index, match.index + match[0].length, match[0], 'season', { season: season.name });
    }
  }

  const yearPatterns = [
    /\b(?:the\s+)?year\s+(\d{1,6})\b/gi,
    /\b(?:in|by|since|until|before|after|during)\s+(\d{3,6})\b/gi,
    /\b(\d{1,6})\s+(?:AD|BC|CE|BCE)\b/gi,
  ];
  if (cal.era) {
    yearPatterns.push(new RegExp(`\\b(\\d{1,6})\\s+(?:of\\s+)?${escapeRe(cal.era)}\\b`, 'gi'));
  }
  for (const re of yearPatterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source))) {
      const year = Number(match[1]);
      if (Number.isInteger(year)) push(match.index, match.index + match[0].length, match[0], 'year', { year });
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

function proposalFor(cal, clock, mention) {
  if (mention.kind === 'month') {
    const day = Math.min(mention.value.day, daysInMonth(cal, clock.year, mention.value.month));
    return { year: clock.year, month: mention.value.month, day, hour: clock.hour ?? 0 };
  }
  if (mention.kind === 'season') {
    return seasonStartOnOrAfter(cal, clock, mention.value.season);
  }
  if (mention.kind === 'year') {
    return {
      year: mention.value.year,
      month: clock.month,
      day: Math.min(clock.day, daysInMonth(cal, mention.value.year, clock.month)),
      hour: clock.hour ?? 0,
    };
  }
  return null;
}

function agrees(cal, clock, mention) {
  if (mention.kind === 'month') {
    return clock.month === mention.value.month && clock.day === mention.value.day;
  }
  if (mention.kind === 'season') {
    return seasonOn(cal, clock)?.name.toLowerCase() === mention.value.season.toLowerCase();
  }
  if (mention.kind === 'year') return clock.year === mention.value.year;
  return true;
}

export function detectFlashback(text) {
  return FLASHBACK.test(String(text ?? ''));
}

/**
 * Visit chapters in manuscript order and give each one a start and an end.
 * A manual clock is an anchor the writer set; everything unanchored follows the
 * previous chapter's end. Flashbacks are skipped entirely.
 */
export function walkChapters(cal, chapters) {
  const ordered = chapters
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
  let cursor = { year: cal.start_year, month: 0, day: 1, hour: 0 };
  const out = [];

  for (const chapter of ordered) {
    const flashback =
      chapter.flashback === true || (chapter.flashback == null && detectFlashback(chapter.text));
    if (flashback) {
      out.push({ id: chapter.id, clock: null, end: null, flashback: true, mentions: [], mismatches: [] });
      continue;
    }
    const start = chapter.manualClock ? clampDate(cal, chapter.manualClock) : { ...cursor };
    const relative = extractRelative(chapter.text ?? '', cal);
    const absolute = extractAbsolute(chapter.text ?? '', cal, relative);
    const mentions = [...relative, ...absolute].sort((a, b) => a.start - b.start);
    const mismatches = [];
    let clock = start;

    for (const mention of mentions) {
      if (mention.kind === 'relative') {
        clock = advance(cal, clock, mention.delta);
        continue;
      }
      if (agrees(cal, clock, mention)) continue;
      const proposed = proposalFor(cal, clock, mention);
      if (!proposed) continue;
      // The chapter may already have moved since it began. Anchor it so that
      // this mention lands on the proposed date, not the chapter's first line.
      const shiftDays = dayIndex(cal, proposed) - dayIndex(cal, clock);
      const shiftHours = (proposed.hour ?? 0) - (clock.hour ?? 0);
      const anchor = addHours(cal, addDays(cal, start, shiftDays), shiftHours);
      mismatches.push({
        key: `${mention.start}:${mention.kind}:${String(mention.raw).toLowerCase()}`,
        kind: mention.kind,
        raw: mention.raw,
        proposed,
        anchor,
        clock: { ...clock },
      });
    }

    cursor = clock;
    out.push({ id: chapter.id, clock: start, end: clock, flashback: false, mentions, mismatches });
  }
  return out;
}

export function validateCalendar(cal) {
  const errors = [];
  if (!cal || typeof cal !== 'object') return { ok: false, errors: ['calendar required'] };
  if (!Array.isArray(cal.months) || cal.months.length === 0) errors.push('at least one month is required');
  if (Array.isArray(cal.months)) {
    if (cal.months.length > 24) errors.push('a year may hold at most 24 months');
    const names = new Set();
    for (const [index, month] of cal.months.entries()) {
      const name = String(month?.name ?? '').trim();
      if (!name) errors.push(`month ${index + 1} needs a name`);
      else if (names.has(name.toLowerCase())) errors.push(`two months are named ${name}`);
      names.add(name.toLowerCase());
      if (!Number.isInteger(month?.days) || month.days < 1 || month.days > 999) {
        errors.push(`${name || `month ${index + 1}`} needs between 1 and 999 days`);
      }
    }
  }
  if (!Number.isInteger(cal.hours_per_day) || cal.hours_per_day < 1 || cal.hours_per_day > 48) {
    errors.push('hours per day must be between 1 and 48');
  }
  if (
    !Number.isInteger(cal.daylight_hours) ||
    cal.daylight_hours < 0 ||
    cal.daylight_hours > (cal.hours_per_day ?? 0)
  ) {
    errors.push('daylight hours must fit inside the day');
  }
  if (!Number.isInteger(cal.days_per_week) || cal.days_per_week < 1 || cal.days_per_week > 20) {
    errors.push('days per week must be between 1 and 20');
  }
  if (!Number.isInteger(cal.week_offset ?? 0) || (cal.week_offset ?? 0) < 0 || (cal.week_offset ?? 0) >= (cal.days_per_week ?? 1)) {
    errors.push('week offset does not fit the week');
  }
  if (!Number.isInteger(cal.start_year)) errors.push('starting year must be a whole number');
  if (cal.leap_every != null) {
    if (!Number.isInteger(cal.leap_every) || cal.leap_every < 2 || cal.leap_every > 1000) {
      errors.push('leap cycle must be between 2 and 1000 years');
    }
    if (!Number.isInteger(cal.leap_month) || cal.leap_month < 0 || cal.leap_month >= (cal.months?.length ?? 0)) {
      errors.push('chosen leap month does not exist');
    }
    if (!Number.isInteger(cal.leap_anchor ?? 0)) errors.push('leap anchor must be a whole number');
  }

  if (Array.isArray(cal.seasons)) {
    const baseDays = cal.months?.reduce((sum, month) => sum + (month?.days ?? 0), 0) ?? 0;
    const names = new Set();
    const ranges = [];
    for (const [index, season] of cal.seasons.entries()) {
      const name = String(season?.name ?? '').trim();
      if (!name) errors.push(`season ${index + 1} needs a name`);
      else if (names.has(name.toLowerCase())) errors.push(`two seasons are named ${name}`);
      names.add(name.toLowerCase());
      if (!Number.isInteger(season?.start_day) || season.start_day < 0 || season.start_day >= baseDays) {
        errors.push(`${name || `season ${index + 1}`} starts outside the year`);
      }
      if (!Number.isInteger(season?.days) || season.days < 1 || season.days > baseDays) {
        errors.push(`${name || `season ${index + 1}`} needs between 1 and ${baseDays} days`);
      } else {
        const end = season.start_day + season.days;
        const segments =
          end <= baseDays
            ? [{ start: season.start_day, end }]
            : [
                { start: season.start_day, end: baseDays },
                { start: 0, end: end - baseDays },
              ];
        ranges.push({ name, segments });
      }
    }
    for (let a = 0; a < ranges.length; a += 1) {
      for (let b = a + 1; b < ranges.length; b += 1) {
        const overlap = ranges[a].segments.some((one) =>
          ranges[b].segments.some((two) => one.start < two.end && two.start < one.end)
        );
        if (overlap) errors.push(`${ranges[a].name} overlaps ${ranges[b].name}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
