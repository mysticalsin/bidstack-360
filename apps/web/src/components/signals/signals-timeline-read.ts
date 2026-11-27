// The signals timeline may paint events only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type SignalsTimelinePhase = 'unread' | 'failed' | 'ready';

export interface SignalsTimelineSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function signalsTimelinePhase(snapshot: SignalsTimelineSnapshot): SignalsTimelinePhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
