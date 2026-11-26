// The score chip may show a number only after the read arrives.
// A pause has isLoading false and no score. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type LeadScorePhase = 'unread' | 'failed' | 'ready';

export interface LeadScoreSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function leadScorePhase(snapshot: LeadScoreSnapshot): LeadScorePhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
