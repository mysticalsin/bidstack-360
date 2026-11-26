// The RFP analytics rollup may paint only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type RfpAnalyticsPhase = 'unread' | 'failed' | 'ready';

export interface RfpAnalyticsSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function rfpAnalyticsPhase(snapshot: RfpAnalyticsSnapshot): RfpAnalyticsPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
