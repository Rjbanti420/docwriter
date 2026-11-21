# The book calendar

The calendar is a book-level definition, a clock per chapter, and a scanner that
compares what the prose claims with that clock. Nothing here invents a date: the
prose moves the clock only when it names a time unit, and a disagreement is
always a suggestion.

## Tables

`calendars` — one row per book.

| column | meaning |
| --- | --- |
| `kind` | `earth` or `custom` |
| `hours_per_day` | length of a day in story hours |
| `daylight_hours` | how many of those hours are day |
| `days_per_week` | grid width |
| `week_offset` | weekday index of the first day of the first month |
| `start_year` | the year the book opens on |
| `era` | free text (`CE`, `Third Age`, …) |
| `leap_every` | `NULL` for no leap days, otherwise the cycle length |
| `leap_month` | 0-based month position that receives the extra day |
| `leap_anchor` | year the leap cycle counts from |

`calendar_months` — `position`, `name`, `days`, ordered by position.

`calendar_seasons` — `name`, `weather`, `start_day`, `days`. `start_day` is a
0-based day-of-year; a season may straddle months and gaps are allowed, so an
unseasoned day simply has no season. `weather` is one editable line.

`chapters` gains `clock_year`, `clock_month`, `clock_day`, `clock_hour`
(the chapter's start), `clock_end_*` (derived), `clock_manual` (the writer
anchored it), and `clock_flashback` (`NULL` = detect from prose, `1` = forced,
`0` = forced off).

`time_mentions` holds open absolute-date disagreements so **Ignore** survives a
re-scan: `chapter_id`, `key`, `kind`, `raw`, `proposed` (JSON), `status`.

## Dates are stored as the writer reads them

`year`, `month` (0-based), `day` (1-based), `hour`. The absolute day index is
derived by `server/calendar.mjs`; it is never stored. Editing a month's length
therefore cannot silently move history — it either leaves every date in place or
is refused.

## The clock walk

Chapters are visited in manuscript order. The first chapter starts at
`start_year`, month 0, day 1, hour 0.

1. A **flashback** chapter gets no clock and is listed under *Elsewhere* with its
   chapter number only. Nothing is computed for it.
2. A chapter with `clock_manual` starts at its saved clock (the writer anchored
   it, usually from a mismatch card). Otherwise it starts where the previous
   chapter ended.
3. Relative mentions inside the chapter move a running clock; the chapter ends
   where the last one leaves it.
4. The next unanchored chapter starts at that end. If a chapter has no time
   mention, it starts and ends at the same instant — chapters stack on a day,
   which is what the day panel exposes.

## Relative phrases

Only a stated unit moves the clock. The table lives in `RELATIVE_PATTERNS` and
is deliberately small and testable.

| phrase shape | delta |
| --- | --- |
| `an hour later`, `3 hours after` | hours |
| `a day later`, `two days after` | days |
| `a week later` | `days_per_week` days |
| `a month later` | months |
| `a year later` | years |
| `the next morning/day/afternoon/night/evening` | 1 day |
| `the following week/month/year` | 1 week/month/year |
| `the following winter` (any season name) | start of that season, this year or next |
| `that evening`, `the same night`, `meanwhile`, `at the same time` | 0 (holds the clock) |
| `moments/seconds/minutes later` | 0 hours |

A time unit with no “later” (“they talked for hours”) does **not** move the
clock. That is intentional: the calendar only ages when the prose says the story
moved.

## Absolute mentions and mismatches

After relative spans are masked out, the scanner looks for:

- `2 February`, `2nd of February`, `February 2` (any calendar month name);
- a season name after `in`, `during`, `by`, `early`, `late`, `the`;
- `year 812`, `in 812`, `812 CE`, and `812 <era>` when an era is named.

Each mention is compared with the clock at that point in the chapter. Agreement
is silent. A disagreement becomes one card:

> Chapter 7 says “the third of Harvest”, but the clock is in Frost, year 814.
> **Set the clock to this** · **Open the line** · **Ignore**

- **Set the clock** anchors that chapter at the proposed date; later unanchored
  chapters move with it.
- **Open the line** opens the chapter; the app never rewrites prose.
- **Ignore** keeps the mention out of later scans.

Year-only and month/day mentions are compared separately; a sentence that names
both may produce two cards. The phrase table, not a general date parser, is the
limit: “by the time the snows came” is not caught.

## Editing a calendar that already has clocks

An edit is refused when a saved clock would fall outside the new month. The
response names the blocker (“Chapter 9 is on day 30 of Harvest; that month has
28 days after this change”). There is no re-mapping and no silent drift. Edits
that only add days, rename a month, or change weather go through, and the clocks
are recomputed.

## Setup

Setup is offered the first time **Timeline › Calendar** is opened, not at first
launch. Earth is one click. The custom wizard asks, in order:

1. how many months and their names;
2. days in each month, and days per week;
3. hours per day and the daylight/night split;
4. leap days: none, or an extra day every N years (which month, which anchor);
5. seasons: none, generated believable ones, or build them by hand (name,
   weather, start month/day, length); seasons may be removed entirely;
6. the starting year and era.

A skipped season step generates four evenly spread seasons with short weather
lines. Unseasoned days remain valid.

## The month view

The server renders one month at a time (`GET /api/calendar/month`): weekday
index, season, and every chapter whose start–end span touches that day. The day
cell is a button, so hover and keyboard focus open the same panel:

- the date, season and weather;
- each chapter touching the day, as a link that opens it;
- “Starts here” where a chapter begins.

Empty days stay silent. A long list caps at six with “+N more”.

## Elsewhere

The side panel lists two things with no computation:

- flashback chapters, by chapter number only;
- timeline events that still carry v1 free-text `story_time`, with their chapter
  anchor when they have one.
