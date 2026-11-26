// A deadlines lane may say "No deadlines" only after the payload arrives.
// A pause has isLoading false and no rows. That read is still unread. A
// failure is not an empty week.

export type CalendarDeadlinesPhase = 'unread' | 'failed' | 'ready';

export interface CalendarDeadlinesSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function calendarDeadlinesPhase(snapshot: CalendarDeadlinesSnapshot): CalendarDeadlinesPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
