// A bid due date is a calendar day (Postgres `date`, no time). Formatting it
// as an instant puts UTC midnight on the previous evening in zones west of
// UTC, so the record names the wrong day. An empty value is not a day.

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatOpportunityDueDay(
  iso: string | null | undefined,
  locale = 'en',
): string | null {
  if (iso == null) return null;
  const trimmed = iso.trim();
  if (!trimmed) return null;
  const match = CALENDAR_DAY.exec(trimmed);
  if (!match) return trimmed;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return trimmed;
  }
  const resolved = locale.trim() || 'en';
  return new Intl.DateTimeFormat(resolved, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
}
