/**
 * calendarPage/layout.ts — pure layout for the calendar views.
 *
 * Every day boundary is computed in the display time zone, so a 21:00
 * Toronto meeting stays on its Toronto day for a viewer in Paris who picks
 * Toronto time. All-day events are stored at UTC midnight of their date and
 * are bucketed by that date in every time zone.
 */
import { zonedWallTimeToUtc } from '@bidstack/shared';

import type { CalendarEvent } from './types';

export const TORONTO_TZ = 'America/Toronto';
const DAY_MS = 86_400_000;
const MIN_BLOCK_MINUTES = 20;

export function userTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || TORONTO_TZ;
}

/** Time zones offered in the switcher: the user's own, then Toronto. */
export function timeZoneChoices(user = userTimeZone()): string[] {
  return user === TORONTO_TZ ? [TORONTO_TZ] : [user, TORONTO_TZ];
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    partsCache.set(tz, f);
  }
  return f;
}

export function zonedParts(d: Date, tz: string) {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(d).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
}

/** YYYY-MM-DD of the instant in the time zone. */
export function dayKey(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function keyToUtcDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function addDays(key: string, n: number): string {
  return new Date(keyToUtcDate(key).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(key: string): number {
  return (keyToUtcDate(key).getUTCDay() + 6) % 7;
}

export function weekKeys(anchor: string): string[] {
  const monday = addDays(anchor, -weekdayIndex(anchor));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The instant the day starts in the time zone. */
export function zonedMidnight(key: string, tz: string): Date {
  return zonedWallTimeToUtc(`${key}T00:00:00`, tz);
}

/** Local Date for the key, for components that bucket by the browser's local date. */
export function keyToLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** All-day events and anything lasting a full day or more go in the lane. */
export function isLaneEvent(ev: CalendarEvent): boolean {
  return ev.isAllDay || new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime() >= DAY_MS;
}

/** First and last day (inclusive) an event covers in the time zone. */
export function eventDaySpan(ev: CalendarEvent, tz: string): [string, string] {
  const start = new Date(ev.startAt);
  const end = new Date(ev.endAt);
  if (ev.isAllDay) {
    const first = start.toISOString().slice(0, 10);
    const endKey = end.toISOString().slice(0, 10);
    return [first, endKey > first ? addDays(endKey, -1) : first];
  }
  const last = end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : start;
  return [dayKey(start, tz), dayKey(last, tz)];
}

export interface TimedBlock {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  /** Column inside its overlap group, 0-based. */
  col: number;
  /** Columns in its overlap group; the block is 1/cols wide. */
  cols: number;
}

/**
 * Timed events of one day, clipped to the day, with side-by-side columns for
 * overlaps (greedy column packing per overlap cluster).
 */
export function layoutTimed(events: CalendarEvent[], key: string, tz: string): TimedBlock[] {
  const dayStart = zonedMidnight(key, tz).getTime();
  const dayEnd = zonedMidnight(addDays(key, 1), tz).getTime();
  // The grid is 24 wall-clock hours even on 23 or 25 hour DST days.
  const dayMinutes = 24 * 60;
  const wallMin = (t: number) => {
    if (t <= dayStart) return 0;
    if (t >= dayEnd) return dayMinutes;
    const p = zonedParts(new Date(t), tz);
    return p.hour * 60 + p.minute;
  };

  const blocks = events
    .filter((ev) => !isLaneEvent(ev))
    .map((ev) => {
      const s = Math.max(new Date(ev.startAt).getTime(), dayStart);
      const e = Math.min(Math.max(new Date(ev.endAt).getTime(), s), dayEnd);
      return { ev, s, e };
    })
    .filter(({ ev, s, e }) => s < dayEnd && (e > dayStart || new Date(ev.startAt).getTime() >= dayStart))
    .map(({ ev, s, e }) => {
      const startMin = wallMin(s);
      const endMin = Math.min(Math.max(wallMin(e), startMin + MIN_BLOCK_MINUTES), dayMinutes);
      return { event: ev, startMin: Math.min(startMin, dayMinutes - MIN_BLOCK_MINUTES), endMin, col: 0, cols: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  let cluster: TimedBlock[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = [];
  const closeCluster = () => {
    for (const b of cluster) b.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const b of blocks) {
    if (b.startMin >= clusterEnd) closeCluster();
    let col = colEnds.findIndex((end) => end <= b.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(b.endMin);
    } else {
      colEnds[col] = b.endMin;
    }
    b.col = col;
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.endMin);
  }
  closeCluster();
  return blocks;
}

export interface LaneSegment {
  event: CalendarEvent;
  startCol: number;
  span: number;
  row: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** All-day and multi-day events as bars across the visible days. */
export function layoutLane(events: CalendarEvent[], keys: string[], tz: string): LaneSegment[] {
  if (keys.length === 0) return [];
  const firstKey = keys[0] as string;
  const lastKey = keys[keys.length - 1] as string;
  const segments = events
    .filter(isLaneEvent)
    .map((event) => {
      const [first, last] = eventDaySpan(event, tz);
      return { event, first, last };
    })
    .filter(({ first, last }) => last >= firstKey && first <= lastKey)
    .sort((a, b) => a.first.localeCompare(b.first) || b.last.localeCompare(a.last))
    .map(({ event, first, last }) => {
      const from = first < firstKey ? firstKey : first;
      const to = last > lastKey ? lastKey : last;
      return {
        event,
        startCol: keys.indexOf(from),
        span: keys.indexOf(to) - keys.indexOf(from) + 1,
        row: 0,
        continuesBefore: first < firstKey,
        continuesAfter: last > lastKey,
      };
    });

  const rowEnds: number[] = [];
  for (const seg of segments) {
    let row = rowEnds.findIndex((end) => end < seg.startCol);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(-1);
    }
    rowEnds[row] = seg.startCol + seg.span - 1;
    seg.row = row;
  }
  return segments;
}

export interface AgendaDay {
  key: string;
  events: CalendarEvent[];
}

/** Days with events, all-day first, then by start time. */
export function groupAgenda(events: CalendarEvent[], keys: string[], tz: string): AgendaDay[] {
  return keys
    .map((key) => ({
      key,
      events: events
        .filter((ev) => {
          const [first, last] = eventDaySpan(ev, tz);
          return first <= key && last >= key;
        })
        .sort(
          (a, b) =>
            Number(isLaneEvent(b)) - Number(isLaneEvent(a)) ||
            new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
        ),
    }))
    .filter((d) => d.events.length > 0);
}

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(
    new Date(iso),
  );
}

export function formatDayLabel(key: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(keyToUtcDate(key));
}

export function timeZoneLabel(tz: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value;
  const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  return name ? `${city} (${name})` : city;
}
