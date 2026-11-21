/**
 * Calendar dates (YYYY-MM-DD). These are not instants.
 *
 * `new Date('2026-03-15')` is UTC midnight. In America/Sao_Paulo that instant
 * is still the evening of 14 Mar, so a task due on the 15th rendered as the
 * 14th. Parse the numeric parts and format a local calendar date instead.
 * Timestamp formatting stays on `formatDate` / `formatInstantDate`.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type PlainDate = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

/** Shape only. `2026-02-31` matches; `parsePlainDate` rejects it. */
export function isDateOnlyString(value: string): boolean {
  return DATE_ONLY.test(value);
}

/**
 * Parse a YYYY-MM-DD civil date. Returns null when the day is not on the
 * calendar (31 Apr, 29 Feb in a common year). The string is never passed to
 * `new Date(string)`.
 */
export function parsePlainDate(input: string): PlainDate | null {
  const match = DATE_ONLY.exec(input);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Overflow check on the numeric parts. Date.UTC here is day arithmetic,
  // not a parse of the original string.
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** Canonical YYYY-MM-DD. `formatPlainDate(parsePlainDate(d)) === d` for every valid d. */
export function formatPlainDate(date: PlainDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
}

export function plainDateFromLocalDate(date: Date): PlainDate {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

export function todayPlainDate(now: Date = new Date()): string {
  return formatPlainDate(plainDateFromLocalDate(now));
}

/**
 * Civil year/month/day. A date-only string keeps the day written in it.
 * An instant keeps the UTC civil day the charts already bucketed on, so
 * `2026-10-01T00:00:00.000Z` stays in October for every viewer.
 */
export function civilParts(iso: string): PlainDate | null {
  const plain = parsePlainDate(iso);
  if (plain) return plain;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  return {
    year: instant.getUTCFullYear(),
    month: instant.getUTCMonth() + 1,
    day: instant.getUTCDate(),
  };
}

/** Local calendar day of an instant, or the civil day when the string is date-only. */
export function localPlainDateOfInstant(iso: string): string | null {
  if (isDateOnlyString(iso)) {
    const parsed = parsePlainDate(iso);
    return parsed ? formatPlainDate(parsed) : null;
  }
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  return formatPlainDate(plainDateFromLocalDate(instant));
}

export function diffPlainDays(from: PlainDate, to: PlainDate): number {
  const start = Date.UTC(from.year, from.month - 1, from.day);
  const end = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((end - start) / 86_400_000);
}

/** Whole calendar days from the local day of `now` to a date-only due date. */
export function daysUntilPlainDate(iso: string, now: Date = new Date()): number | null {
  const due = parsePlainDate(iso);
  if (!due) return null;
  return diffPlainDays(plainDateFromLocalDate(now), due);
}

export function addPlainDays(iso: string, days: number): string | null {
  const date = parsePlainDate(iso);
  if (!date) return null;
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return formatPlainDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** 0 = Monday ... 6 = Sunday, for a date-only key. */
export function weekdayIndexMonday(iso: string): number | null {
  const date = parsePlainDate(iso);
  if (!date) return null;
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return (utc.getUTCDay() + 6) % 7;
}

/**
 * Sort key. Date-only values sort by their civil day (the same instant
 * `new Date('YYYY-MM-DD')` used to produce). Timestamps sort by their instant.
 */
export function chronologicalKey(iso: string): number {
  const plain = parsePlainDate(iso);
  if (plain) return Date.UTC(plain.year, plain.month - 1, plain.day);
  return new Date(iso).getTime();
}

const DEFAULT_DISPLAY: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

/** Display a date-only string as that calendar day in `locale`. */
export function formatPlainDateDisplay(
  value: string,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = parsePlainDate(value);
  if (!date) return '—';
  const local = new Date(date.year, date.month - 1, date.day);
  return local.toLocaleDateString(locale, options ?? DEFAULT_DISPLAY);
}

/** Display an instant in the viewer's zone (or `options.timeZone` when set). */
export function formatInstantDate(
  iso: string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Date(iso).toLocaleDateString(locale, options ?? DEFAULT_DISPLAY);
}
