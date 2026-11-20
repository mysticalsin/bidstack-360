/** Wall-clock parts of an instant in one IANA time zone. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/**
 * The instant at which the wall clock in `timeZone` reads the given local
 * time. On a fall-back day the earlier of the two instants wins. A wall time
 * inside a spring-forward gap maps to the first valid instant after the gap,
 * so it stays on the same calendar day.
 */
export function zonedTimeToUtc(
  local: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  const wall = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour ?? 0,
    local.minute ?? 0,
    local.second ?? 0,
  );
  const before = wall - offsetMs(new Date(wall - HALF_DAY_MS), timeZone);
  const after = wall - offsetMs(new Date(wall + HALF_DAY_MS), timeZone);
  const roundTrips = (t: number): boolean => {
    const p = zonedParts(new Date(t), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) === wall;
  };
  const candidates = [before, after].filter(roundTrips).sort((a, b) => a - b);
  return new Date(candidates[0] ?? before);
}

/** `YYYY-MM-DD` calendar date of `date` in `timeZone`. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
