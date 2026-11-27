/**
 * The calendar may call a day free only after the events list arrives.
 * A paused read has isLoading false and no payload. That read is still
 * unread. A success payload with no list is not an empty week.
 */

export type CalendarEventsRead = 'checking' | 'failed' | 'empty' | 'ready';

export function calendarEventsRead(status: string, items: unknown): CalendarEventsRead {
  if (status === 'error') return 'failed';
  if (status !== 'success') return 'checking';
  if (!Array.isArray(items)) return 'failed';
  return items.length === 0 ? 'empty' : 'ready';
}
