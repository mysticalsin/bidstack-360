// The full deal catalog may paint only after the page walk arrives.
// A pause has isLoading false and no pages. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type DealOptionsPhase = 'unread' | 'failed' | 'ready';

export interface DealOptionsSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function dealOptionsPhase(snapshot: DealOptionsSnapshot): DealOptionsPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
