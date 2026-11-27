// SERUM mission control may say the ledger, heartbeats, queues, or gates are
// empty only after the status payload arrives. A pause has isLoading false and
// no snapshot. That read is still unread. A failure is not an empty mission.

export type SerumStatusPhase = 'unread' | 'failed' | 'ready';

export interface SerumStatusReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function serumStatusPhase(snapshot: SerumStatusReadSnapshot): SerumStatusPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
