/**
 * Whole UTC calendar days from today to an activity. Today is 0.
 * The feed counted elapsed hours, so an afternoon timestamp 30 UTC days
 * out was not labeled 30 days, and a time earlier on today's UTC date
 * was not labeled today.
 */
const DAY_MS = 86_400_000;

export function activityDaysFromToday(iso: string, now = Date.now()): number {
  const at = new Date(iso);
  const clock = new Date(now);
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const today = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate());
  return (day - today) / DAY_MS;
}

/** "today", "yesterday", "in 30 days", "30 days ago". Day words follow the UTC date. */
export function activityWhen(iso: string, now = Date.now(), locale = 'en'): string {
  const days = activityDaysFromToday(iso, now);
  if (Math.abs(days) <= 30) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}
