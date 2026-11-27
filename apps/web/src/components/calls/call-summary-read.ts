// A call summary may show a missing summary only after the payload arrives.
// A pause has isLoading false and no call. That read is still unread.
// A failure with no payload is not a missing summary.

export type CallSummaryPhase = 'unread' | 'failed' | 'ready';

export interface CallSummaryReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function callSummaryPhase(snapshot: CallSummaryReadSnapshot): CallSummaryPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
