import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { chapterLabel } from '../chapters';
import type {
  CalendarChapter,
  CalendarDate,
  CalendarDay,
  CalendarMonthView,
  CalendarState,
  Chapter,
} from '../types';

const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
const SEASON_WEATHER = [
  'Mild and wet; new growth after the last frost.',
  'Long, warm days; the driest stretch of the year.',
  'Cooling, windy; the harvest and early rain.',
  'Short, cold days; frost, snow and bare trees.',
];
const WIZARD_STEPS = ['Months', 'Month lengths', 'Days and nights', 'Leap days', 'Seasons', 'Year'];

interface SeasonDraft {
  name: string;
  weather: string;
  startMonth: number;
  startDay: number;
  days: number;
}

function yearDays(months: Array<{ days: number }>): number {
  return months.reduce((sum, month) => sum + (Number(month.days) || 0), 0);
}

function monthStart(months: Array<{ days: number }>, index: number): number {
  let total = 0;
  for (let i = 0; i < index && i < months.length; i += 1) total += Number(months[i].days) || 0;
  return total;
}

function monthDayFromOffset(months: Array<{ days: number }>, offset: number): { month: number; day: number } {
  let remaining = Math.max(0, offset);
  for (let index = 0; index < months.length; index += 1) {
    const days = Number(months[index].days) || 0;
    if (remaining < days) return { month: index, day: remaining + 1 };
    remaining -= days;
  }
  const last = Math.max(0, months.length - 1);
  return { month: last, day: Math.max(1, Number(months[last]?.days) || 1) };
}

function generatedSeasonDrafts(months: Array<{ days: number }>): SeasonDraft[] {
  const total = yearDays(months);
  if (!total) return [];
  const count = total >= 8 ? 4 : total >= 4 ? 2 : 1;
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => {
    const start = index * base;
    const days = index === count - 1 ? total - start : base;
    const startAt = monthDayFromOffset(months, start);
    return {
      name: SEASON_NAMES[index],
      weather: SEASON_WEATHER[index],
      startMonth: startAt.month,
      startDay: startAt.day,
      days,
    };
  });
}

function generatedSeasonPayload(months: Array<{ days: number }>) {
  return generatedSeasonDrafts(months).map((season) => ({
    name: season.name,
    weather: season.weather,
    start_day: monthStart(months, season.startMonth) + season.startDay - 1,
    days: season.days,
  }));
}

function clockText(calendar: CalendarState['calendar'], date: CalendarDate | null): string {
  if (!calendar || !date) return 'No clock yet';
  const name = calendar.months[date.month]?.name ?? `Month ${date.month + 1}`;
  return `${date.day} ${name} ${date.year}${calendar.era ? ` ${calendar.era}` : ''}, ${String(date.hour ?? 0).padStart(2, '0')}:00`;
}

function errorText(error: unknown): string {
  const body = (error as { body?: unknown })?.body;
  if (body && typeof body === 'object') {
    const value = body as { error?: unknown; blockers?: Array<{ detail?: string }> };
    if (value.blockers?.length) return value.blockers.map((b) => b.detail ?? '').filter(Boolean).join(' ');
    if (value.error) return String(value.error);
  }
  return error instanceof Error ? error.message : String(error);
}

export default function CalendarPanel({
  chapters,
  onOpenChapter,
}: {
  chapters: Chapter[];
  onOpenChapter: (id: number) => void;
}) {
  const [data, setData] = useState<CalendarState | null>(null);
  const [view, setView] = useState<CalendarMonthView | null>(null);
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null);
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [clockFor, setClockFor] = useState<CalendarChapter | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const applyState = useCallback((next: CalendarState, resetMonth = false) => {
    setData(next);
    if (next.calendar) {
      setCursor((current) =>
        resetMonth || !current ? { year: next.calendar!.start_year, month: 0 } : current
      );
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const next = await api.refreshCalendar();
        if (alive) applyState(next);
      } catch (err) {
        if (alive) setError(errorText(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyState]);

  useEffect(() => {
    if (!data?.calendar || !cursor) {
      setView(null);
      return;
    }
    let alive = true;
    api
      .calendarMonth(cursor.year, cursor.month)
      .then((next) => {
        if (!alive) return;
        setView(next);
        setSelected(null);
        setShowAll(false);
      })
      .catch((err) => {
        if (alive) setError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [data, cursor]);

  const run = async (label: string, work: () => Promise<CalendarState>) => {
    setBusy(label);
    setError('');
    try {
      const next = await work();
      applyState(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  };

  const createEarth = async () => {
    setBusy('earth');
    setError('');
    try {
      const next = await api.saveCalendar({ kind: 'earth' });
      applyState(next, true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  };

  const shownChapters = selected ? (showAll ? selected.chapters : selected.chapters.slice(0, 6)) : [];
  const season = selected?.season ?? null;
  const currentSeason = useMemo(
    () => data?.seasons.find((item) => item.name === season) ?? null,
    [data?.seasons, season]
  );

  if (loading) return <div className="empty-state">Reading the calendar…</div>;

  if (error && !data) {
    return (
      <div className="save-error" role="alert">
        <div>{error}</div>
        <button className="btn-secondary" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data?.calendar) {
    return (
      <>
        {error && (
          <div className="save-error" role="alert">
            <div>{error}</div>
          </div>
        )}
        <section className="cal-setup" aria-labelledby="cal-setup-title">
          <p className="cal-kicker">Timeline · Calendar</p>
          <h2 id="cal-setup-title">Give this book a calendar</h2>
          <p className="card-note">
            The calendar moves only when a chapter names a time unit — “a day later”, “an hour later”. A chapter
            with no time reference stays where it is, so the day view can show several chapters sharing a date.
          </p>
          <div className="cal-setup__choices">
            <button type="button" className="cal-choice" onClick={() => void createEarth()} disabled={busy !== ''}>
              <span className="cal-choice__icon" aria-hidden="true">
                ◐
              </span>
              <strong>Earth</strong>
              <span>Twelve months, seven-day weeks, four seasons. One click, and you can edit it later.</span>
            </button>
            <button type="button" className="cal-choice" onClick={() => setWizard(true)}>
              <span className="cal-choice__icon" aria-hidden="true">
                ✶
              </span>
              <strong>Build my own</strong>
              <span>
                Name the months, set their lengths, choose the hours in a day, add seasons or leave them out.
              </span>
            </button>
          </div>
          <p className="cal-setup__foot">
            {chapters.length === 0
              ? 'Paste a chapter first if you like; the calendar can wait.'
              : `${chapters.length} chapter${chapters.length === 1 ? '' : 's'} will be placed on it from the prose.`}
          </p>
        </section>
        {wizard && (
          <CalendarWizard
            initial={null}
            onClose={() => setWizard(false)}
            onSaved={(next) => {
              setWizard(false);
              applyState(next, true);
            }}
          />
        )}
      </>
    );
  }

  const calendar = data.calendar;

  return (
    <div className="cal">
      <div className="cal-head">
        <div>
          <p className="cal-kicker">{calendar.kind === 'earth' ? 'Earth calendar' : calendar.name}</p>
          <h2>{view ? `${view.monthName} ${view.year}` : 'Calendar'}</h2>
          <p className="cal-head__sub">
            {calendar.hours_per_day} hours a day · {calendar.daylight_hours} of daylight · {calendar.days_per_week}-day
            week
            {calendar.leap_every ? ` · a leap day every ${calendar.leap_every} years` : ''}
          </p>
        </div>
        <div className="cal-head__actions">
          {view && (
            <>
              <button
                type="button"
                className="cal-nav"
                aria-label="Previous month"
                onClick={() => setCursor(view.prev)}
              >
                ←
              </button>
              <button type="button" className="cal-nav" aria-label="Next month" onClick={() => setCursor(view.next)}>
                →
              </button>
            </>
          )}
          <button type="button" className="btn-secondary" onClick={() => setWizard(true)}>
            Edit calendar
          </button>
        </div>
      </div>

      {error && (
        <div className="save-error" role="alert">
          <div>{error}</div>
          <button type="button" className="btn-secondary" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      {data.mismatches.length > 0 && (
        <section className="cal-mismatches" aria-labelledby="cal-mismatch-title">
          <div className="cal-section-head">
            <h3 id="cal-mismatch-title">Clock disagreements</h3>
            <span className="dw-chip-count">{data.mismatches.length}</span>
          </div>
          <p className="card-note">
            The prose names a date the clock does not agree with. Nothing moves until you choose.
          </p>
          <div className="cal-mismatch-list">
            {data.mismatches.map((mismatch) => (
              <article className="cal-mismatch" key={mismatch.id}>
                <p>
                  <strong>Chapter {mismatch.chapter_number || mismatch.chapter_id}</strong>
                  {mismatch.chapter_title ? ` — ${mismatch.chapter_title}` : ''} says “{mismatch.raw}”, but the
                  clock is at {mismatch.clock_label}.
                </p>
                <p className="cal-mismatch__target">Proposed: {mismatch.proposed_label}.</p>
                <div className="cal-mismatch__actions">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy !== ''}
                    onClick={() => void run(`mismatch-${mismatch.id}`, () => api.applyCalendarMention(mismatch.id))}
                  >
                    {busy === `mismatch-${mismatch.id}` ? 'Setting…' : 'Set the clock to this'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => onOpenChapter(mismatch.chapter_id)}>
                    Open the line
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy !== ''}
                    onClick={() => void run(`ignore-${mismatch.id}`, () => api.ignoreCalendarMention(mismatch.id))}
                  >
                    Ignore
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="cal-layout">
        <div className="cal-main">
          {view && (
            <>
              <div
                className="cal-weekdays"
                style={{ '--cal-week': view.calendar.days_per_week } as CSSProperties}
                aria-hidden="true"
              >
                {view.weekdays.map((weekday) => (
                  <span key={weekday}>{weekday}</span>
                ))}
              </div>
              <div
                className="cal-grid"
                style={{ '--cal-week': view.calendar.days_per_week } as CSSProperties}
                role="grid"
                aria-label={`${view.monthName} ${view.year}`}
              >
                {Array.from({ length: view.firstWeekday }, (_, index) => (
                  <span className="cal-cell cal-cell--blank" key={`blank-${index}`} aria-hidden="true" />
                ))}
                {view.days.map((day) => {
                  const count = day.chapters.length;
                  const label = `${day.day} ${view.monthName} ${view.year}${day.season ? `, ${day.season}` : ''}${
                    count ? `, ${count} chapter${count === 1 ? '' : 's'}` : ''
                  }`;
                  return (
                    <button
                      type="button"
                      role="gridcell"
                      className={`cal-cell${selected?.day === day.day ? ' is-selected' : ''}${
                        day.season ? ' has-season' : ''
                      }${count ? ' has-chapters' : ''}`}
                      key={day.day}
                      aria-label={label}
                      aria-pressed={selected?.day === day.day}
                      onMouseEnter={() => {
                        setSelected(day);
                        setShowAll(false);
                      }}
                      onFocus={() => {
                        setSelected(day);
                        setShowAll(false);
                      }}
                      onClick={() => {
                        setSelected(day);
                        setShowAll(false);
                      }}
                    >
                      <span className="cal-cell__num">{day.day}</span>
                      {day.season && <span className="cal-cell__season">{day.season}</span>}
                      {count > 0 && (
                        <span className="cal-cell__dots" aria-hidden="true">
                          {day.chapters.slice(0, 4).map((chapter) => (
                            <i key={`${day.day}-${chapter.id}`} />
                          ))}
                          {count > 4 && <em>+{count - 4}</em>}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <section className="cal-day" aria-live="polite" aria-label="Selected day">
            {selected && view ? (
              <>
                <div className="cal-day__head">
                  <h3>
                    {selected.day} {view.monthName} {view.year}
                  </h3>
                  <span>{selected.season ? `${selected.season}${currentSeason?.weather ? ` · ${currentSeason.weather}` : ''}` : 'No season on this day'}</span>
                </div>
                {selected.chapters.length === 0 ? (
                  <p className="cal-day__empty">Nothing in the manuscript happens on this day.</p>
                ) : (
                  <>
                    <p className="cal-day__note">
                      {selected.chapters.length} chapter{selected.chapters.length === 1 ? '' : 's'} touch this day:
                    </p>
                    <div className="cal-day__chapters">
                      {shownChapters.map((chapter) => (
                        <button
                          type="button"
                          className="cal-day__chapter"
                          key={chapter.id}
                          onClick={() => onOpenChapter(chapter.id)}
                        >
                          <span>{chapter.label}</span>
                          {chapter.title && <small>{chapter.title}</small>}
                          {chapter.starts && <em>Starts here</em>}
                        </button>
                      ))}
                    </div>
                    {selected.chapters.length > 6 && !showAll && (
                      <button type="button" className="ghost" onClick={() => setShowAll(true)}>
                        +{selected.chapters.length - 6} more
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="cal-day__empty">Hover or focus a day to see which chapters happen then.</p>
            )}
          </section>

          <section className="cal-chapters" aria-labelledby="cal-chapters-title">
            <div className="cal-section-head">
              <h3 id="cal-chapters-title">Chapter clocks</h3>
              <span className="dw-chip-count">{data.chapters.length}</span>
            </div>
            <p className="card-note">
              A chapter starts where the last one ended. If its prose names no time unit, it does not move the
              clock. Set a clock by hand only when the prose was vague.
            </p>
            <ul className="cal-chapter-list">
              {data.chapters.map((chapter) => (
                <li className="cal-chapter-row" key={chapter.id}>
                  <button
                    type="button"
                    className="cal-chapter-row__name"
                    onClick={() => onOpenChapter(chapter.id)}
                  >
                    {chapterLabel(chapter)}
                  </button>
                  <span className={`cal-chapter-row__clock${chapter.flashback ? ' is-flashback' : ''}`}>
                    {chapter.flashback
                      ? 'Flashback · not on the calendar'
                      : clockText(calendar, chapter.clock)}
                    {chapter.manual && !chapter.flashback && <em> · by hand</em>}
                  </span>
                  <button type="button" className="ghost" onClick={() => setClockFor(chapter)}>
                    {chapter.flashback ? 'Put back' : 'Set clock'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="cal-side">
          <section className="cal-side-card" aria-labelledby="cal-seasons-title">
            <h3 id="cal-seasons-title">Seasons</h3>
            {data.seasons.length === 0 ? (
              <p className="card-note">This calendar has no seasons. Every day is unseasoned.</p>
            ) : (
              <ul className="cal-season-list">
                {data.seasons.map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    {item.weather && <span>{item.weather}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cal-side-card" aria-labelledby="cal-elsewhere-title">
            <h3 id="cal-elsewhere-title">Elsewhere</h3>
            <p className="card-note">
              Flashbacks and v1 time notes. Nothing here is computed or placed on the calendar.
            </p>
            {data.elsewhere.length === 0 ? (
              <p className="card-note">No flashbacks or undated notes.</p>
            ) : (
              <ul className="cal-elsewhere">
                {data.elsewhere.map((item, index) =>
                  item.kind === 'chapter' ? (
                    <li key={`chapter-${item.chapter_id}`}>
                      <button
                        type="button"
                        className="cal-elsewhere__link"
                        onClick={() => item.chapter_id != null && onOpenChapter(item.chapter_id)}
                      >
                        {item.label}
                        {item.title ? ` — ${item.title}` : ''}
                      </button>
                      <span className="cal-elsewhere__tag">Flashback</span>
                    </li>
                  ) : (
                    <li key={`note-${index}`}>
                      <span className="cal-elsewhere__note">
                        <strong>{item.title}</strong>
                        <small>
                          {item.label} · {item.text}
                        </small>
                      </span>
                    </li>
                  )
                )}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {wizard && (
        <CalendarWizard
          initial={data}
          onClose={() => setWizard(false)}
          onSaved={(next) => {
            setWizard(false);
            applyState(next);
          }}
        />
      )}

      {clockFor && (
        <ClockModal
          calendar={calendar}
          chapter={clockFor}
          onClose={() => setClockFor(null)}
          onState={(next) => {
            setClockFor(null);
            applyState(next);
          }}
        />
      )}
    </div>
  );
}

function ClockModal({
  calendar,
  chapter,
  onClose,
  onState,
}: {
  calendar: NonNullable<CalendarState['calendar']>;
  chapter: CalendarChapter;
  onClose: () => void;
  onState: (next: CalendarState) => void;
}) {
  const [year, setYear] = useState(chapter.clock?.year ?? calendar.start_year);
  const [month, setMonth] = useState(chapter.clock?.month ?? 0);
  const [day, setDay] = useState(chapter.clock?.day ?? 1);
  const [hour, setHour] = useState(chapter.clock?.hour ?? 0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const save = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setError('');
    try {
      onState(await api.setChapterClock(chapter.id, body));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cal-clock-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="modal-head">
          <h2 id="cal-clock-title">{chapterLabel(chapter)}</h2>
        </div>
        <div className="modal-body cal-clock-form">
          {error && <div className="save-error">{error}</div>}
          {chapter.flashback ? (
            <p className="card-note">
              This chapter is a flashback: it is listed under Elsewhere and the calendar computes nothing for it.
            </p>
          ) : (
            <p className="card-note">Set the chapter's starting point by hand. Later unanchored chapters follow it.</p>
          )}
          <div className="cal-field-row">
            <label className="cal-field">
              <span>Year</span>
              <input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} />
            </label>
            <label className="cal-field">
              <span>Month</span>
              <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
                {calendar.months.map((item, index) => (
                  <option key={item.name} value={index}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="cal-field">
              <span>Day</span>
              <input type="number" min={1} value={day} onChange={(event) => setDay(Number(event.target.value))} />
            </label>
            <label className="cal-field">
              <span>Hour</span>
              <input
                type="number"
                min={0}
                max={calendar.hours_per_day - 1}
                value={hour}
                onChange={(event) => setHour(Number(event.target.value))}
              />
            </label>
          </div>
          {chapter.manual && !chapter.flashback && (
            <p className="card-note">This clock is anchored by hand. Following the calendar removes the anchor.</p>
          )}
        </div>
        <div className="modal-foot cal-clock-foot">
          <button
            type="button"
            className="ghost"
            disabled={busy !== ''}
            onClick={() => void save({ flashback: !chapter.flashback }, 'flashback')}
          >
            {chapter.flashback ? 'Put back on the calendar' : 'Mark as flashback'}
          </button>
          {chapter.manual && !chapter.flashback && (
            <button
              type="button"
              className="ghost"
              disabled={busy !== ''}
              onClick={() => void save({ clear: true }, 'clear')}
            >
              Follow the calendar
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== '' || chapter.flashback}
            onClick={() => void save({ year, month, day, hour }, 'save')}
          >
            {busy === 'save' ? 'Saving…' : 'Save clock'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CalendarWizard({
  initial,
  onClose,
  onSaved,
}: {
  initial: CalendarState | null;
  onClose: () => void;
  onSaved: (next: CalendarState) => void;
}) {
  const existing = initial?.calendar ?? null;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(existing?.name && existing.name !== 'Earth' ? existing.name : 'My calendar');
  const [monthCount, setMonthCount] = useState(initial?.months.length || 6);
  const [months, setMonths] = useState<Array<{ name: string; days: number }>>(
    initial?.months.length
      ? initial.months.map((month) => ({ name: month.name, days: month.days }))
      : Array.from({ length: 6 }, (_, index) => ({ name: `Month ${index + 1}`, days: 30 }))
  );
  const [daysPerWeek, setDaysPerWeek] = useState(existing?.days_per_week ?? 7);
  const [hoursPerDay, setHoursPerDay] = useState(existing?.hours_per_day ?? 24);
  const [daylight, setDaylight] = useState(existing?.daylight_hours ?? 12);
  const [leapMode, setLeapMode] = useState<'none' | 'every'>(existing?.leap_every ? 'every' : 'none');
  const [leapEvery, setLeapEvery] = useState(existing?.leap_every ?? 4);
  const [leapMonth, setLeapMonth] = useState(existing?.leap_month ?? 1);
  const [leapAnchor, setLeapAnchor] = useState(existing?.leap_anchor ?? 0);
  const [seasonMode, setSeasonMode] = useState<'none' | 'generate' | 'custom'>(
    initial?.seasons.length ? 'custom' : initial?.calendar ? 'none' : 'generate'
  );
  const [seasons, setSeasons] = useState<SeasonDraft[]>(
    initial?.seasons.length
      ? initial.seasons.map((season) => {
          const at = monthDayFromOffset(initial.months, season.start_day);
          return {
            name: season.name,
            weather: season.weather,
            startMonth: at.month,
            startDay: at.day,
            days: season.days,
          };
        })
      : []
  );
  const [startYear, setStartYear] = useState(existing?.start_year ?? 1);
  const [era, setEra] = useState(existing?.era ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const resizeMonths = (count: number) => {
    const next = Math.min(Math.max(Math.round(count) || 1, 1), 24);
    setMonthCount(next);
    setMonths((current) =>
      Array.from({ length: next }, (_, index) => current[index] ?? { name: `Month ${index + 1}`, days: 30 })
    );
    if (leapMonth >= next) setLeapMonth(0);
  };

  const totalDays = yearDays(months);

  const stepError = (): string => {
    if (step === 0) {
      const names = months.map((month) => month.name.trim().toLowerCase());
      if (names.some((value) => !value)) return 'Give every month a name.';
      if (new Set(names).size !== names.length) return 'Two months cannot share a name.';
    }
    if (step === 1) {
      if (months.some((month) => !Number.isInteger(month.days) || month.days < 1 || month.days > 999)) {
        return 'Every month needs between 1 and 999 days.';
      }
      if (!Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 20) {
        return 'Days per week must be between 1 and 20.';
      }
    }
    if (step === 2) {
      if (!Number.isInteger(hoursPerDay) || hoursPerDay < 1 || hoursPerDay > 48) {
        return 'Hours per day must be between 1 and 48.';
      }
      if (!Number.isInteger(daylight) || daylight < 0 || daylight > hoursPerDay) {
        return 'Daylight must fit inside the day.';
      }
    }
    if (step === 3 && leapMode === 'every') {
      if (!Number.isInteger(leapEvery) || leapEvery < 2 || leapEvery > 1000) {
        return 'The leap cycle must be between 2 and 1000 years.';
      }
      if (leapMonth < 0 || leapMonth >= months.length) return 'Choose a month for the extra day.';
    }
    if (step === 4 && seasonMode === 'custom') {
      const groups = seasons.map((season) => ({
        ...season,
        start: monthStart(months, season.startMonth) + season.startDay - 1,
      }));
      if (groups.some((season) => !season.name.trim())) return 'Give every season a name.';
      const names = groups.map((season) => season.name.trim().toLowerCase());
      if (new Set(names).size !== names.length) return 'Two seasons cannot share a name.';
      const ranges = groups
        .map((season) => ({ name: season.name, start: season.start, end: season.start + season.days }))
        .sort((a, b) => a.start - b.start);
      if (ranges.some((range) => !Number.isInteger(range.start) || range.start < 0 || range.start >= totalDays)) {
        return 'A season starts outside the year.';
      }
      if (ranges.some((range) => !Number.isInteger(range.end) || range.end <= range.start || range.end > totalDays)) {
        return 'A season runs past the end of the year.';
      }
      for (let index = 1; index < ranges.length; index += 1) {
        if (ranges[index].start < ranges[index - 1].end) return 'Two seasons overlap.';
      }
    }
    if (step === 5 && !Number.isInteger(startYear)) return 'Name the starting year with a whole number.';
    return '';
  };

  const next = () => {
    const problem = stepError();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setStep((current) => Math.min(current + 1, WIZARD_STEPS.length - 1));
  };

  const back = () => {
    setError('');
    setStep((current) => Math.max(current - 1, 0));
  };

  const submit = async () => {
    const problem = stepError();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const seasonPayload =
        seasonMode === 'none'
          ? []
          : seasonMode === 'generate'
            ? generatedSeasonPayload(months)
            : seasons.map((season) => ({
                name: season.name.trim(),
                weather: season.weather.trim(),
                start_day: monthStart(months, season.startMonth) + season.startDay - 1,
                days: season.days,
              }));
      const nextState = await api.saveCalendar({
        kind: 'custom',
        name: name.trim() || 'My calendar',
        hours_per_day: hoursPerDay,
        daylight_hours: daylight,
        days_per_week: daysPerWeek,
        week_offset: 0,
        start_year: startYear,
        era: era.trim(),
        leap_every: leapMode === 'every' ? leapEvery : null,
        leap_month: leapMode === 'every' ? leapMonth : null,
        leap_anchor: leapMode === 'every' ? (Number.isInteger(leapAnchor) ? leapAnchor : startYear) : 0,
        months: months.map((month, index) => ({
          position: index,
          name: month.name.trim(),
          days: month.days,
        })),
        seasons: seasonPayload,
      });
      onSaved(nextState);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cal-wizard-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="modal-head">
          <div className="cal-wizard__steps" aria-hidden="true">
            {WIZARD_STEPS.map((label, index) => (
              <span key={label} className={index <= step ? 'is-done' : ''}>
                {index + 1}
              </span>
            ))}
          </div>
          <h2 id="cal-wizard-title">
            {existing ? 'Edit calendar' : 'Build a calendar'} · {WIZARD_STEPS[step]}
          </h2>
        </div>
        <div className="modal-body cal-wizard">
          {error && (
            <div className="save-error" role="alert">
              {error}
            </div>
          )}

          {step === 0 && (
            <div className="cal-wizard__section">
              <p className="card-note">
                A year is made of months. Six is a good default; you can use up to 24. Names can be anything.
              </p>
              <label className="cal-field cal-field--short">
                <span>Months in a year</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={monthCount}
                  onChange={(event) => resizeMonths(Number(event.target.value))}
                />
              </label>
              <div className="cal-month-names">
                {months.map((month, index) => (
                  <label className="cal-field" key={index}>
                    <span>Month {index + 1}</span>
                    <input
                      value={month.name}
                      onChange={(event) =>
                        setMonths((current) =>
                          current.map((item, position) =>
                            position === index ? { ...item, name: event.target.value } : item
                          )
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="cal-wizard__section">
              <p className="card-note">Each month can carry a different number of days. Seasons may straddle them.</p>
              <div className="cal-month-names">
                {months.map((month, index) => (
                  <label className="cal-field" key={index}>
                    <span>{month.name || `Month ${index + 1}`}</span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={month.days}
                      onChange={(event) =>
                        setMonths((current) =>
                          current.map((item, position) =>
                            position === index ? { ...item, days: Number(event.target.value) } : item
                          )
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="cal-wizard__total">
                {totalDays} days in a common year
                {leapMode === 'every' ? ', plus one in a leap year' : ''}.
              </p>
              <label className="cal-field cal-field--short">
                <span>Days in a week</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={daysPerWeek}
                  onChange={(event) => setDaysPerWeek(Number(event.target.value))}
                />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="cal-wizard__section">
              <p className="card-note">
                Hours are story hours. Day and night split the day; the month view only uses the split for the
                summary line.
              </p>
              <div className="cal-field-row">
                <label className="cal-field">
                  <span>Hours in a day</span>
                  <input
                    type="number"
                    min={1}
                    max={48}
                    value={hoursPerDay}
                    onChange={(event) => setHoursPerDay(Number(event.target.value))}
                  />
                </label>
                <label className="cal-field">
                  <span>Hours of daylight</span>
                  <input
                    type="number"
                    min={0}
                    max={hoursPerDay}
                    value={daylight}
                    onChange={(event) => setDaylight(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="cal-daynight" aria-hidden="true">
                <span style={{ flex: Math.max(0, daylight) }} className="cal-daynight__day" />
                <span style={{ flex: Math.max(0, hoursPerDay - daylight) }} className="cal-daynight__night" />
              </div>
              <p className="cal-wizard__total">
                {daylight} hours of day · {Math.max(0, hoursPerDay - daylight)} hours of night
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="cal-wizard__section">
              <p className="card-note">
                Leap days are optional. If you want them, choose the cycle and which month receives the extra day.
              </p>
              <div className="cal-radios">
                <label>
                  <input
                    type="radio"
                    name="leap"
                    checked={leapMode === 'none'}
                    onChange={() => setLeapMode('none')}
                  />
                  No leap days
                </label>
                <label>
                  <input
                    type="radio"
                    name="leap"
                    checked={leapMode === 'every'}
                    onChange={() => setLeapMode('every')}
                  />
                  An extra day every N years
                </label>
              </div>
              {leapMode === 'every' && (
                <div className="cal-field-row">
                  <label className="cal-field">
                    <span>Every</span>
                    <input
                      type="number"
                      min={2}
                      max={1000}
                      value={leapEvery}
                      onChange={(event) => setLeapEvery(Number(event.target.value))}
                    />
                  </label>
                  <label className="cal-field">
                    <span>Extra day in</span>
                    <select value={leapMonth} onChange={(event) => setLeapMonth(Number(event.target.value))}>
                      {months.map((month, index) => (
                        <option key={month.name} value={index}>
                          {month.name || `Month ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cal-field">
                    <span>Cycle counts from year</span>
                    <input
                      type="number"
                      value={leapAnchor}
                      onChange={(event) => setLeapAnchor(Number(event.target.value))}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="cal-wizard__section">
              <p className="card-note">
                Seasons are day ranges. They can straddle months, leave gaps, or be removed entirely. Skipping
                this step generates four believable seasons.
              </p>
              <div className="cal-radios">
                <label>
                  <input
                    type="radio"
                    name="seasons"
                    checked={seasonMode === 'none'}
                    onChange={() => setSeasonMode('none')}
                  />
                  No seasons
                </label>
                <label>
                  <input
                    type="radio"
                    name="seasons"
                    checked={seasonMode === 'generate'}
                    onChange={() => setSeasonMode('generate')}
                  />
                  Generate believable seasons
                </label>
                <label>
                  <input
                    type="radio"
                    name="seasons"
                    checked={seasonMode === 'custom'}
                    onChange={() => {
                      setSeasonMode('custom');
                      // Seeded on demand, so months edited in an earlier step
                      // cannot leave length-invalid drafts behind.
                      setSeasons((current) => (current.length ? current : generatedSeasonDrafts(months)));
                    }}
                  />
                  Build them myself
                </label>
              </div>

              {seasonMode === 'generate' && (
                <ul className="cal-wizard__preview">
                  {generatedSeasonDrafts(months).map((season) => (
                    <li key={season.name}>
                      <strong>{season.name}</strong>
                      <span>
                        {months[season.startMonth]?.name} {season.startDay} · {season.days} days ·{' '}
                        {season.weather}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {seasonMode === 'custom' && (
                <div className="cal-season-drafts">
                  {seasons.map((season, index) => (
                    <div className="cal-season-draft" key={index}>
                      <label className="cal-field">
                        <span>Name</span>
                        <input
                          value={season.name}
                          onChange={(event) =>
                            setSeasons((current) =>
                              current.map((item, position) =>
                                position === index ? { ...item, name: event.target.value } : item
                              )
                            )
                          }
                        />
                      </label>
                      <label className="cal-field cal-field--grow">
                        <span>Weather</span>
                        <input
                          value={season.weather}
                          onChange={(event) =>
                            setSeasons((current) =>
                              current.map((item, position) =>
                                position === index ? { ...item, weather: event.target.value } : item
                              )
                            )
                          }
                        />
                      </label>
                      <label className="cal-field">
                        <span>Starts</span>
                        <select
                          value={season.startMonth}
                          onChange={(event) =>
                            setSeasons((current) =>
                              current.map((item, position) =>
                                position === index
                                  ? { ...item, startMonth: Number(event.target.value), startDay: 1 }
                                  : item
                              )
                            )
                          }
                        >
                          {months.map((month, position) => (
                            <option key={position} value={position}>
                              {month.name || `Month ${position + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="cal-field cal-field--tiny">
                        <span>Day</span>
                        <input
                          type="number"
                          min={1}
                          value={season.startDay}
                          onChange={(event) =>
                            setSeasons((current) =>
                              current.map((item, position) =>
                                position === index ? { ...item, startDay: Number(event.target.value) } : item
                              )
                            )
                          }
                        />
                      </label>
                      <label className="cal-field cal-field--tiny">
                        <span>Days</span>
                        <input
                          type="number"
                          min={1}
                          value={season.days}
                          onChange={(event) =>
                            setSeasons((current) =>
                              current.map((item, position) =>
                                position === index ? { ...item, days: Number(event.target.value) } : item
                              )
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="ghost cal-season-draft__remove"
                        onClick={() => setSeasons((current) => current.filter((_, position) => position !== index))}
                        aria-label={`Remove ${season.name || `season ${index + 1}`}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="cal-wizard__row">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        setSeasons((current) => [
                          ...current,
                          { name: '', weather: '', startMonth: 0, startDay: 1, days: 10 },
                        ])
                      }
                    >
                      + Add season
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setSeasons(generatedSeasonDrafts(months))}
                    >
                      Start from generated
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="cal-wizard__section">
              <p className="card-note">The year the book opens on. The clock starts at the first day of the first month.</p>
              <div className="cal-field-row">
                <label className="cal-field">
                  <span>Starting year</span>
                  <input
                    type="number"
                    value={startYear}
                    onChange={(event) => setStartYear(Number(event.target.value))}
                  />
                </label>
                <label className="cal-field">
                  <span>Era (optional)</span>
                  <input value={era} onChange={(event) => setEra(event.target.value)} placeholder="Third Age" />
                </label>
                <label className="cal-field">
                  <span>Calendar name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} />
                </label>
              </div>
              <div className="cal-review">
                <h3>Your calendar</h3>
                <p>
                  {months.length} months · {totalDays} days{leapMode === 'every' ? ` (+1 every ${leapEvery} years)` : ''} ·{' '}
                  {hoursPerDay} hours a day · {daysPerWeek}-day week
                </p>
                <p>
                  Starts {startYear}
                  {era ? ` ${era}` : ''}.{' '}
                  {seasonMode === 'none'
                    ? 'No seasons.'
                    : `${seasonMode === 'generate' ? 'Generated' : 'Custom'} seasons: ${(seasonMode === 'generate'
                        ? generatedSeasonDrafts(months)
                        : seasons
                      )
                        .map((season) => season.name)
                        .filter(Boolean)
                        .join(', ')}.`}
                </p>
                <div className="cal-review__months">
                  {months.map((month, index) => (
                    <span key={index}>
                      {month.name} <small>{month.days}d</small>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot cal-wizard__foot">
          <span className="cal-wizard__progress">
            Step {step + 1} of {WIZARD_STEPS.length}
          </span>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {step > 0 && (
            <button type="button" className="btn-secondary" onClick={back} disabled={busy}>
              Back
            </button>
          )}
          {step < WIZARD_STEPS.length - 1 ? (
            <button type="button" className="btn-primary" onClick={next}>
              Next
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Saving…' : existing ? 'Save calendar' : 'Create calendar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
