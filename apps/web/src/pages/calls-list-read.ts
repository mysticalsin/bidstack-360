// A calls list may say "No calls found" or count 0 only after the
// payload arrives. A pause has isLoading false and no rows. That read is
// still unread. A failure is not an empty book.

export type CallsListPhase = 'unread' | 'failed' | 'ready';

export interface CallsListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: 'pending' | 'error' | 'success';
}

export function callsListPhase(snapshot: CallsListSnapshot): CallsListPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
