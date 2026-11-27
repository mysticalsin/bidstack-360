// The factors panel may show a score only after the read arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type ScoreFactorsPhase = 'unread' | 'failed' | 'ready';

export interface ScoreFactorsSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function scoreFactorsPhase(snapshot: ScoreFactorsSnapshot): ScoreFactorsPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
