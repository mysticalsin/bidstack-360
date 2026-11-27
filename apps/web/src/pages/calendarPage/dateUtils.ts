/**
 * calendarPage/dateUtils.ts — local-day helpers shared by the calendar grid
 * and the deadlines lane.
 */
import { formatPlainDate, plainDateFromLocalDate } from '@/lib/plain-date';

/**
 * Local Y-M-D, NOT toISOString().slice(0,10): the grid renders local days and
 * hours, so day-bucketing must use the local calendar date. toISOString shifts
 * across midnight for any non-UTC offset, which put events on the wrong day.
 */
export function toLocalIsoDate(d: Date): string {
  return formatPlainDate(plainDateFromLocalDate(d));
}
