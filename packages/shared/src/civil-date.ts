// Civil dates for task due days.
//
// Draft PR #379 (apps/web/src/lib/plain-date.ts) parses YYYY-MM-DD without
// calling `new Date` on the string, and the web due-today filter follows the
// viewer's calendar. This module is the shared clock. #379 should adopt
// `summaryToday`, `parseCivilDate`, and `addCivilDays` instead of keeping a
// second parser in plain-date.ts.
//
// `summaryToday` is the calendar day in the org timezone (America/Sao_Paulo
// when the org has not stored one). At 22:00 there, UTC has already moved to
// the next date; the task clock stays on the local day.

/** Task clock when the org has not stored a timezone. */
export const DEFAULT_TASK_TIME_ZONE = 'America/Sao_Paulo';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Stored org timezone when it is a real IANA zone, otherwise America/Sao_Paulo. */
export function resolveTaskTimeZone(configured?: string | null): string {
  const zone = configured?.trim();
  if (zone && isValidTimeZone(zone)) return zone;
  return DEFAULT_TASK_TIME_ZONE;
}

/** YYYY-MM-DD parts, or null when the day is not on the calendar. Never parses via `new Date(string)`. */
export function parseCivilDate(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Calendar day of `now` in `timeZone`. */
export function summaryToday(now: Date, timeZone: string = DEFAULT_TASK_TIME_ZONE): string {
  const zone = resolveTaskTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

/** Add calendar days to a YYYY-MM-DD date. Day arithmetic, not an instant shift. */
export function addCivilDays(iso: string, days: number): string {
  const parsed = parseCivilDate(iso);
  if (!parsed) return iso;
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

export function isDueOn(dueDate: string | null, civilDay: string): boolean {
  return dueDate !== null && dueDate === civilDay;
}

export function isOverdueOn(dueDate: string | null, civilDay: string): boolean {
  return dueDate !== null && dueDate < civilDay;
}

export function isDueToday(dueDate: string | null, now: Date, timeZone?: string): boolean {
  return isDueOn(dueDate, summaryToday(now, timeZone));
}

export function isOverdue(dueDate: string | null, now: Date, timeZone?: string): boolean {
  return isOverdueOn(dueDate, summaryToday(now, timeZone));
}
