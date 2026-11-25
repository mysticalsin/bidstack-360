import { formatDate } from '@/lib/format';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Print a bid due date on that calendar day.
 *
 * `new Date('YYYY-MM-DD')` is UTC midnight. West of UTC that instant is still
 * the previous evening, so the Due cell showed yesterday while the date on
 * the bid, and the overdue chip's day count, kept the real day. Demo bids
 * are stored as dates. An updated-at timestamp must not come through here.
 */
export function formatOpportunityDueDate(
  dueDate: string | null | undefined,
  locale = 'en',
): string {
  if (!dueDate) return formatDate(dueDate);
  const match = DATE_ONLY.exec(dueDate);
  if (!match) return dueDate;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return dueDate;
  const utc = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC overflows 31 Feb into March. That is not the deadline on the bid.
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return dueDate;
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
}
