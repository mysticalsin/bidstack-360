// The activity-by-hour card may paint a count only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type ActivityHourPhase = 'unread' | 'failed' | 'ready';

export interface ActivityHourSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function activityHourPhase(snapshot: ActivityHourSnapshot): ActivityHourPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
