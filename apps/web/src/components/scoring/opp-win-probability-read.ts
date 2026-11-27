// The probability chip may show a number only after the read arrives.
// A pause has isLoading false and no probability. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type OppWinProbabilityPhase = 'unread' | 'failed' | 'ready';

export interface OppWinProbabilitySnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function oppWinProbabilityPhase(snapshot: OppWinProbabilitySnapshot): OppWinProbabilityPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
