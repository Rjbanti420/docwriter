// Export-reminder policy — DB-free so it stays unit-testable.
//
// Dates are plain YYYY-MM-DD local calendar days, never timestamps: "every day"
// means the calendar day changed, not 24 hours elapsed, so a writer who exports
// each morning is not nagged in the afternoon.
//
// One period is satisfied by exporting *or* dismissing, so the effective date is
// the later of the two. Otherwise "Later" would be asked again on the next launch.

/** Reminder frequencies offered in Settings. */
export const NUDGE_FREQUENCIES = ['off', 'daily', 'weekly', 'monthly'];

const DAYS = { daily: 1, weekly: 7, monthly: 30 };

/** Whole days from `a` to `b`, both YYYY-MM-DD, or null if either is unusable. */
function daysBetween(a, b) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const from = parse(a);
  const to = parse(b);
  if (!from || !to) return null;
  return Math.round((to - from) / 86_400_000);
}

/** Should the reminder appear now? */
export function isNudgeDue({ nudge, lastExportAt, lastNudgedOn, today }) {
  if (nudge === 'off' || !NUDGE_FREQUENCIES.includes(nudge)) return false;
  // ISO dates sort chronologically, so the max is the most recent activity.
  const last = [lastExportAt, lastNudgedOn].filter(Boolean).sort().pop() ?? null;
  if (!last) return true;
  const elapsed = daysBetween(last, today);
  // An unreadable stored date must not silence the reminder forever.
  if (elapsed == null) return true;
  return elapsed >= DAYS[nudge];
}
