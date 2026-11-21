// Civil dates for task due days.
//
// Draft PR #379 (apps/web/src/lib/plain-date.ts) parses YYYY-MM-DD without
// calling `new Date` on the string, and the web due-today filter follows the
// viewer's calendar. This module is the shared clock both that helper and the
// server should use. #379 should adopt these functions instead of keeping a
// second parser.
//
// `summaryToday` is still the UTC date `/api/tasks/summary` slices from
// `toISOString()`. At 22:00 in America/Sao_Paulo that UTC date is already the
// next day, so a task due on the local day is overdue on the badge and due
// today on the page.

/** Polo's task clock when the org has not stored a timezone. */
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

/** Org timezone when one is stored, otherwise America/Sao_Paulo. */
export function resolveTaskTimeZone(configured?: string | null): string {
  const zone = configured?.trim();
  if (zone && isValidTimeZone(zone)) return zone;
  return DEFAULT_TASK_TIME_ZONE;
}

/**
 * The date `/api/tasks/summary` compares due dates against.
 * Currently the UTC calendar day, which is the next day at 22:00 in a zone
 * west of UTC.
 */
export function summaryToday(now: Date, _timeZone: string = DEFAULT_TASK_TIME_ZONE): string {
  return now.toISOString().slice(0, 10);
}

export function isDueToday(dueDate: string | null, now: Date, timeZone?: string): boolean {
  return dueDate !== null && dueDate === summaryToday(now, timeZone);
}

export function isOverdue(dueDate: string | null, now: Date, timeZone?: string): boolean {
  return dueDate !== null && dueDate < summaryToday(now, timeZone);
}
