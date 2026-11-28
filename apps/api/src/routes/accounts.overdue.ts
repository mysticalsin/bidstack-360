/**
 * Close-date clock for Strategic and Top account lists.
 *
 * due_date is a calendar date. A day before today (UTC) is past close.
 * Today still has the rest of the UTC day, and a missing date is not late.
 * Closed won/lost deals are excluded by the queries that call this, not here.
 */

/** Midnight UTC of the day that contains `now`. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** True when an open deal's close date is a previous UTC day. */
export function openDealIsPastClose(due: Date | null, now: Date): boolean {
  if (!due) return false;
  return due.getTime() < utcDayStart(now).getTime();
}
