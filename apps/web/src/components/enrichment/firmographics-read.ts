// The firmographics strip may show company facts only after the enrichment read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type FirmographicsPhase = 'unread' | 'failed' | 'ready';

export interface FirmographicsSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function firmographicsPhase(snapshot: FirmographicsSnapshot): FirmographicsPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
