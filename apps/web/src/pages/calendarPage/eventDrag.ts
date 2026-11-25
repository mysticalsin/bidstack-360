/**
 * Where a dragged calendar event lands.
 *
 * Timed drops keep the wall clock in the calendar's time zone. All-day drops
 * are a calendar date. The lane reads that date from the UTC instant, so a
 * viewer's local midnight is the wrong instant: in a zone ahead of UTC it is
 * still the previous UTC date, and the bar paints on the day before the drop.
 */
import { calendarDateToUtc, zonedWallTimeToUtc } from '@bidstack/shared';

import { addDays } from './layout';

export interface EventMove {
  startAt: string;
  endAt: string;
  isAllDay: boolean;
}

const DAY_MS = 86_400_000;

export interface DragSpan {
  startAt: string;
  endAt: string;
  isAllDay: boolean;
}

/** Days an all-day bar covers. A timed event dropped on the lane covers one day. */
export function allDayLengthDays(event: DragSpan): number {
  if (!event.isAllDay) return 1;
  const start = Date.parse(`${event.startAt.slice(0, 10)}T00:00:00.000Z`);
  const end = Date.parse(`${event.endAt.slice(0, 10)}T00:00:00.000Z`);
  const days = Math.round((end - start) / DAY_MS);
  return days > 0 ? days : 1;
}

/**
 * Drop on the all-day lane. `dayKey` is the column under the pointer.
 * The instant is UTC midnight of that date, which is the same date the lane
 * reads back in every time zone.
 */
export function moveToAllDay(dayKey: string, spanDays: number): EventMove {
  const start = calendarDateToUtc(dayKey);
  const end = calendarDateToUtc(addDays(dayKey, Math.max(spanDays, 1)));
  return { startAt: start.toISOString(), endAt: end.toISOString(), isAllDay: true };
}

/** Drop on an hour row. Keeps the event's duration and leaves the all-day lane. */
export function moveToHour(event: DragSpan, dayKey: string, hour: number, tz: string): EventMove {
  const duration = Math.max(new Date(event.endAt).getTime() - new Date(event.startAt).getTime(), 15 * 60 * 1000);
  const hh = String(hour).padStart(2, '0');
  const start = zonedWallTimeToUtc(`${dayKey}T${hh}:00:00`, tz);
  return {
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + duration).toISOString(),
    isAllDay: false,
  };
}

export interface DropTarget {
  kind: 'all-day' | 'hour';
  dayKey: string;
  hour?: number;
}

/** The day or hour cell under the pointer. Walks past a preview drawn on top. */
export function dropTargetFromElement(el: Element | null): DropTarget | null {
  let node: Element | null = el;
  while (node) {
    const drop = node.getAttribute('data-drop');
    const dayKey = node.getAttribute('data-day');
    if (dayKey && drop === 'all-day') return { kind: 'all-day', dayKey };
    if (dayKey && drop === 'hour') {
      const hour = Number(node.getAttribute('data-hour'));
      if (Number.isInteger(hour)) return { kind: 'hour', dayKey, hour };
    }
    node = node.parentElement;
  }
  return null;
}
