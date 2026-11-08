/**
 * Provider event times to UTC instants.
 *
 * All-day events are pinned to UTC midnight of their calendar date so every
 * viewer sees them on the same day whatever their timezone; timed events are
 * real instants.
 */

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

function datePart(value: string): string {
  return value.slice(0, 10);
}

/** UTC midnight of a YYYY-MM-DD calendar date. */
export function calendarDateToUtc(date: string): Date {
  return new Date(`${datePart(date)}T00:00:00.000Z`);
}

function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function isKnownZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Interpret a wall-clock time (no offset) in an IANA zone and return the
 * instant. Unknown zones fall back to UTC.
 */
export function zonedWallTimeToUtc(wall: string, timeZone: string): Date {
  const trimmed = wall.replace(/\.\d+$/, '');
  const naive = Date.parse(`${trimmed}Z`);
  if (Number.isNaN(naive)) return new Date(Number.NaN);
  if (!timeZone || timeZone.toUpperCase() === 'UTC' || !isKnownZone(timeZone)) return new Date(naive);
  // Two passes settle the offset across a DST boundary.
  let guess = naive - offsetMs(naive, timeZone);
  guess = naive - offsetMs(guess, timeZone);
  return new Date(guess);
}

/** Microsoft Graph `{ dateTime, timeZone }` to a UTC instant. */
export function graphEventTime(t: { dateTime?: string; timeZone?: string } | undefined, isAllDay: boolean): Date {
  const value = t?.dateTime;
  if (!value) return new Date(Number.NaN);
  if (isAllDay) return calendarDateToUtc(value);
  if (HAS_OFFSET.test(value)) return new Date(value);
  return zonedWallTimeToUtc(value, t?.timeZone ?? 'UTC');
}

/** Google Calendar `{ date }` or `{ dateTime, timeZone }` to a UTC instant. */
export function googleEventTime(t: { date?: string; dateTime?: string; timeZone?: string } | undefined): Date {
  if (t?.date && !t.dateTime) return calendarDateToUtc(t.date);
  const value = t?.dateTime;
  if (!value) return new Date(Number.NaN);
  if (HAS_OFFSET.test(value)) return new Date(value);
  return zonedWallTimeToUtc(value, t?.timeZone ?? 'UTC');
}
