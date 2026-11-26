// The follow control may show Follow, Following, or Muted only after the read arrives.
// A pause has isLoading false and no status. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type FollowAccountPhase = 'unread' | 'failed' | 'ready';

export interface FollowAccountSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function followAccountPhase(snapshot: FollowAccountSnapshot): FollowAccountPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
