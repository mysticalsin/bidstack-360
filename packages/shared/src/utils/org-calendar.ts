import { zonedDateKey, zonedParts, zonedTimeToUtc } from '../public-sector/time.js';

/** Column default on `org_settings.timezone`. Invalid stored values fall back here. */
export const ORG_TIME_ZONE_FALLBACK = 'America/Toronto';

/**
 * A stored IANA zone, or the org default when the value is missing or unknown.
 * `Intl` throws on a zone it does not know; that must not 500 a report.
 */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  const candidate = timeZone?.trim() || ORG_TIME_ZONE_FALLBACK;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return ORG_TIME_ZONE_FALLBACK;
  }
}

export interface QuarterBounds {
  /** `YYYY-Qn` in the org's wall calendar. */
  key: string;
  /** Inclusive start: local midnight on the first day of the quarter. */
  start: Date;
  /** Exclusive end: local midnight on the first day of the next quarter. */
  end: Date;
}

/**
 * The org-local quarter that contains `instant`.
 *
 * UTC quarters mis-file the last hours of a São Paulo quarter. 2026-01-01
 * 02:00 UTC is still 31 Dec 2025 in America/Sao_Paulo, so it belongs to
 * 2025-Q4, and the quarter ends at 2026-01-01 03:00 UTC (local midnight).
 */
export function quarterBounds(instant: Date, timeZone?: string | null): QuarterBounds {
  const zone = resolveTimeZone(timeZone);
  const parts = zonedParts(instant, zone);
  const quarter = Math.floor((parts.month - 1) / 3) + 1;
  const startMonth = (quarter - 1) * 3 + 1;
  const start = zonedTimeToUtc({ year: parts.year, month: startMonth, day: 1, hour: 0 }, zone);
  const endMonthIndex = startMonth + 3;
  const end = zonedTimeToUtc(
    {
      year: parts.year + (endMonthIndex > 12 ? 1 : 0),
      month: ((endMonthIndex - 1) % 12) + 1,
      day: 1,
      hour: 0,
    },
    zone,
  );
  return { key: `${parts.year}-Q${quarter}`, start, end };
}

export interface DateOnlyRange {
  /** Inclusive local midnight of `from`, when set. */
  gte?: Date;
  /** Exclusive local midnight after `to`, when set. */
  lt?: Date;
}

/**
 * `YYYY-MM-DD` of `instant` in the org timezone. This is the civil day for
 * "today" and for overdue: a due date before this day is overdue, and the
 * day itself is not.
 *
 * 22:00 in America/Sao_Paulo is 01:00 UTC the next day. That evening is still
 * the same local date, so a UTC calendar day marks a task due "today" as
 * overdue. #375's task summary can adopt this instead of
 * `new Date().toISOString().slice(0, 10)`.
 */
export function civilDay(instant: Date, timeZone?: string | null): string {
  return zonedDateKey(instant, resolveTimeZone(timeZone));
}

/**
 * True when a `YYYY-MM-DD` due date is strictly before the org's civil day.
 * A missing due date is not overdue.
 */
export function isBeforeCivilDay(
  dueDate: string | null | undefined,
  instant: Date,
  timeZone?: string | null,
): boolean {
  if (!dueDate) return false;
  return dueDate < civilDay(instant, timeZone);
}

/**
 * The civil day encoded as UTC midnight, for a `@db.Date` comparison.
 * Prisma reads the UTC date of the bound. Local midnight in a zone east of
 * UTC falls on the previous UTC date, so binding local midnight would shift
 * the day. This value does not.
 */
export function civilDayAsUtcDate(instant: Date, timeZone?: string | null): Date {
  return new Date(`${civilDay(instant, timeZone)}T00:00:00.000Z`);
}

function nextCivilDay(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + 1);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function civilParts(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split('-').map((part) => Number(part));
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

/**
 * Inclusive local calendar range for a date-only filter.
 *
 * `to=2025-12-31` in America/Sao_Paulo includes 2026-01-01 02:30 UTC (still
 * 31 Dec locally) and excludes 2026-01-01 03:00 UTC (1 Jan locally). A UTC
 * end-of-day bound does the opposite.
 */
export function dateOnlyRange(
  from: string | undefined,
  to: string | undefined,
  timeZone?: string | null,
): DateOnlyRange {
  const zone = resolveTimeZone(timeZone);
  const range: DateOnlyRange = {};
  if (from) {
    const start = civilParts(from);
    range.gte = zonedTimeToUtc({ ...start, hour: 0 }, zone);
  }
  if (to) {
    const end = nextCivilDay(civilParts(to).year, civilParts(to).month, civilParts(to).day);
    range.lt = zonedTimeToUtc({ ...end, hour: 0 }, zone);
  }
  return range;
}
