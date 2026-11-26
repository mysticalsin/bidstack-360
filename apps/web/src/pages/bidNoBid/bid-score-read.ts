// A bid score may say "Not yet rated" or show a composite of 0 only after
// the latest-score payload arrives. A pause has isLoading false and no row.
// That read is still unread. A failure is not an unscored deal. A 404 is a
// settled miss: the deal has no score.

export type BidScoreReadPhase = 'idle' | 'unread' | 'missing' | 'failed' | 'ready';

export interface BidScoreReadSnapshot {
  opportunityId?: string;
  data?: unknown;
  isError?: boolean;
  error?: unknown;
  status?: string;
}

function statusCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function bidScoreReadPhase(snapshot: BidScoreReadSnapshot): BidScoreReadPhase {
  if (!snapshot.opportunityId) return 'idle';
  if (snapshot.isError === true || snapshot.status === 'error') {
    return statusCodeOf(snapshot.error) === 404 ? 'missing' : 'failed';
  }
  if (snapshot.data === undefined) return 'unread';
  if (snapshot.data === null) return 'missing';
  return 'ready';
}
