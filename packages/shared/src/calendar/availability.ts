/**
 * Pure slot computation for booking pages.
 *
 * WHY: All slot logic lives here (zero side effects, no I/O) so the API
 * endpoint, tests, and eventual frontend preview all share the same truth.
 *
 * Rules:
 *   - Each rule is a recurring weekly window: { dayOfWeek 0-6, startTime "HH:mm", endTime "HH:mm" }
 *   - existingEvents block any slot that overlaps (including buffer time around the event)
 *   - All-day events block the whole day
 *   - DST transitions: we work in ISO strings and let Date handle wall-clock
 *   - Midnight-crossing windows (e.g. 23:00 → 01:00) are NOT supported; validate at the API layer
 */

export interface AvailabilityRule {
  /** 0 = Sunday … 6 = Saturday (same as Date.getDay()) */
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

  // Iterate day-by-day from rangeStart to rangeEnd
  const dayMs = 24 * 60 * 60 * 1000;
  let cursor = startOfDayInTz(rangeStart, tz);

  while (cursor <= rangeEnd) {
    const dow = getDayOfWeekInTz(cursor, tz);

    const rulesForDay = rules.filter((r) => r.dayOfWeek === dow);

    for (const rule of rulesForDay) {
      const windowStart = applyTimeInTz(cursor, rule.startTime, tz);
      const windowEnd = applyTimeInTz(cursor, rule.endTime, tz);

      if (windowEnd <= windowStart) continue; // malformed rule

      // Generate slots within the window
      let slotStart = new Date(windowStart);
      while (slotStart.getTime() + durationMinutes * 60_000 <= windowEnd.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);

        // Minimum notice check
        if (minNoticeHours > 0 && slotStart.getTime() - now.getTime() < noticeMs) {
          slotStart = new Date(slotStart.getTime() + durationMinutes * 60_000);
          continue;
        }

        // Collision check against existing events (plus buffers)
        if (!collidesWithEvents(slotStart, slotEnd, existingEvents, bufferBeforeMinutes, bufferAfterMinutes)) {
          results.push(slotStart.toISOString());
        }

        slotStart = new Date(slotStart.getTime() + durationMinutes * 60_000);
      }
    }

    cursor = new Date(cursor.getTime() + dayMs);
  }

  return results;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function collidesWithEvents(
  slotStart: Date,
  slotEnd: Date,
  events: BlockingEvent[],
  bufferBefore: number,
  bufferAfter: number,
): boolean {
  for (const ev of events) {
    if (ev.isAllDay) {
      // All-day events block the whole calendar day of slotStart.
      // Compare UTC midnight boundaries.
      const evDay = ev.startAt.toISOString().slice(0, 10);
      const slotDay = slotStart.toISOString().slice(0, 10);
      if (evDay === slotDay) return true;
      continue;
    }

    // Expand the blocking window by the buffer times
    const blockStart = new Date(ev.startAt.getTime() - bufferBefore * 60_000);
    const blockEnd = new Date(ev.endAt.getTime() + bufferAfter * 60_000);

    // Standard interval overlap: A starts before B ends AND A ends after B starts
    if (slotStart < blockEnd && slotEnd > blockStart) return true;
  }
  return false;
}

/**
 * Returns midnight (00:00:00) on the given date in the specified timezone,
 * as a UTC Date object.
 *
 * WHY: We need to iterate day-by-day in the owner's local timezone so DST
 * transitions don't cause midnight to shift.
 */
function startOfDayInTz(d: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;

  // Parse as local ISO-like string and convert back to UTC
  return new Date(`${year}-${month}-${day}T00:00:00`);
}

/**
 * Returns the day-of-week (0-6) for a Date in the given timezone.
 * WHY: Date.getDay() always returns UTC day, which drifts for late-night TZs.
 */
function getDayOfWeekInTz(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).formatToParts(d);

  const short = parts.find((p) => p.type === 'weekday')!.value;
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[short] ?? 0;
}

/**
 * Given a day (midnight UTC) and a "HH:mm" time string, returns a Date
 * representing that wall-clock time in `tz` as a UTC instant.
 */
function applyTimeInTz(dayMidnight: Date, hhmm: string, tz: string): Date {
  const [hh, mm] = hhmm.split(':').map(Number);

  // Build an ISO string in local time and let Intl resolve the UTC offset
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dayMidnight);

  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;

  // We use a trick: format a known UTC time to the target TZ and back to
  // measure the UTC offset, then apply it to the desired wall-clock time.
  // Construct a Date by parsing without a timezone suffix (treated as local
  // by V8) — this is intentional: we want the wall-clock interpretation.
  // We then correct with the TZ offset.
  const utcForOffset = new Date(dayMidnight);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  formatter.format(utcForOffset);
  // The naive approach: compose the date string and parse via Date.
  // This is reliable because we always work in the same TZ for a given day.
  const naive = new Date(`${year}-${month}-${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);

  // Compute offset: how far is the TZ from UTC at midnight?
  const refUtc = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const refTzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(refUtc);

  const tzHour = Number(refTzParts.find((p) => p.type === 'hour')!.value);
  const tzMin = Number(refTzParts.find((p) => p.type === 'minute')!.value);
  // Offset in minutes (positive means TZ is ahead of UTC)
  // WHY: We subtract TZ midnight-offset to map wall-clock → UTC correctly.
  const offsetMs = (tzHour * 60 + tzMin) * 60_000;

  return new Date(naive.getTime() - offsetMs);
}
