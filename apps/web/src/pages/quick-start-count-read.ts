// Quick Start may count leads, deals, and teammates only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type QuickStartCountPhase = 'unread' | 'failed' | 'ready';

export interface QuickStartCountSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function quickStartCountPhase(snapshot: QuickStartCountSnapshot): QuickStartCountPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
