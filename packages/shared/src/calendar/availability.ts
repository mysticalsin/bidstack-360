/**
 * Pure slot computation for booking pages.
 *
 * WHY: All slot logic lives here (zero side effects, no I/O) so the API
 * endpoint, tests, and eventual frontend preview all share the same truth.
 *
 * Rules:
 *   - Each rule is a recurring weekly window: { dayOfWeek 0-6, startTime "HH:mm", endTime "HH:mm" }
 *   - existingEvents block any slot that overlaps, including buffer time around the event
 *   - All-day events block the whole day
 *   - Timezone conversion maps wall-clock availability to UTC instants
 *   - Midnight-crossing windows (e.g. 23:00 to 01:00) are not supported
 */

export interface AvailabilityRule {
  /** 0 = Sunday ... 6 = Saturday (same as Date.getDay()) */
  dayOfWeek: number;
  /** "HH:mm" in the booking page owner's local timezone */
  startTime: string;
  /** "HH:mm" in the booking page owner's local timezone */
  endTime: string;
}

export interface BlockingEvent {
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
}

export interface SlotComputeOptions {
  rules: AvailabilityRule[];
  existingEvents: BlockingEvent[];
  /** First day of the range to generate slots for (inclusive, start of day in `tz`) */
  rangeStart: Date;
  /** Last day of the range to generate slots for (inclusive, end of day in `tz`) */
  rangeEnd: Date;
  durationMinutes: number;
  /** Buffer in minutes to add before and after each booked slot */
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  /** IANA timezone string e.g. "Europe/Paris". Defaults to UTC. */
  tz?: string;
  /** Minimum notice in hours from now (slots sooner than this are dropped). Default 0. */
  minNoticeHours?: number;
}

/** Returned slot: always represented as an ISO-8601 string (UTC) */
export type Slot = string;

/**
 * Returns an array of ISO-8601 start times for available slots.
 * The array is sorted ascending and contains no duplicates.
 */
export function computeSlots(opts: SlotComputeOptions): Slot[] {
  const {
    rules,
    existingEvents,
    rangeStart,
    rangeEnd,
    durationMinutes,
    bufferBeforeMinutes = 0,
    bufferAfterMinutes = 0,
    tz = 'UTC',
    minNoticeHours = 0,
  } = opts;

  if (!rules.length) return [];
  if (durationMinutes <= 0) return [];

  const now = new Date();
  const noticeMs = minNoticeHours * 60 * 60 * 1000;

  const results: Slot[] = [];

  const dayMs = 24 * 60 * 60 * 1000;
  let cursor = startOfDayInTz(rangeStart, tz);

  while (cursor <= rangeEnd) {
    const dow = getDayOfWeekInTz(cursor, tz);
    const rulesForDay = rules.filter((r) => r.dayOfWeek === dow);

    for (const rule of rulesForDay) {
      const windowStart = applyTimeInTz(cursor, rule.startTime, tz);
      const windowEnd = applyTimeInTz(cursor, rule.endTime, tz);

      if (windowEnd <= windowStart) continue;

      let slotStart = new Date(windowStart);
      while (slotStart.getTime() + durationMinutes * 60_000 <= windowEnd.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);

        if (minNoticeHours > 0 && slotStart.getTime() - now.getTime() < noticeMs) {
          slotStart = new Date(slotStart.getTime() + durationMinutes * 60_000);
          continue;
        }

        if (
          !collidesWithEvents(
            slotStart,
            slotEnd,
            existingEvents,
            bufferBeforeMinutes,
            bufferAfterMinutes,
          )
        ) {
          results.push(slotStart.toISOString());
        }

        slotStart = new Date(slotStart.getTime() + durationMinutes * 60_000);
      }
    }

    cursor = new Date(cursor.getTime() + dayMs);
  }

  return results;
}

function collidesWithEvents(
  slotStart: Date,
  slotEnd: Date,
  events: BlockingEvent[],
  bufferBefore: number,
  bufferAfter: number,
): boolean {
  for (const ev of events) {
    if (ev.isAllDay) {
      const evDay = ev.startAt.toISOString().slice(0, 10);
      const slotDay = slotStart.toISOString().slice(0, 10);
      if (evDay === slotDay) return true;
      continue;
    }

    const blockStart = new Date(ev.startAt.getTime() - bufferBefore * 60_000);
    const blockEnd = new Date(ev.endAt.getTime() + bufferAfter * 60_000);

    if (slotStart < blockEnd && slotEnd > blockStart) return true;
  }
  return false;
}

function startOfDayInTz(d: Date, tz: string): Date {
  const { year, month, day } = getZonedDateTimeParts(d, tz);
  return zonedTimeToUtc(year, month, day, 0, 0, 0, tz);
}

function getDayOfWeekInTz(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).formatToParts(d);

  const short = parts.find((p) => p.type === 'weekday')?.value;
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return short ? (map[short] ?? 0) : 0;
}

function applyTimeInTz(dayMidnight: Date, hhmm: string, tz: string): Date {
  const [hour = 0, minute = 0] = hhmm.split(':').map(Number);
  const { year, month, day } = getZonedDateTimeParts(dayMidnight, tz);
  return zonedTimeToUtc(year, month, day, hour, minute, 0, tz);
}

function getZonedDateTimeParts(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(d);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

function getTimeZoneOffsetMs(d: Date, tz: string): number {
  const parts = getZonedDateTimeParts(d, tz);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return zonedAsUtc - d.getTime();
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const firstOffset = getTimeZoneOffsetMs(utcGuess, tz);
  const firstResult = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = getTimeZoneOffsetMs(firstResult, tz);
  return new Date(utcGuess.getTime() - secondOffset);
}
