// The opportunity bid-score card may say the bid has no score only after
// the latest-score read settles. A pause has isLoading false and no row.
// That read has not arrived. A 404 is a settled miss. Any other error
// is a failed read.

export type OpportunityBidScorePhase = 'unread' | 'failed' | 'missing' | 'ready';

export interface OpportunityBidScoreSnapshot {
  data?: unknown;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  status?: 'pending' | 'error' | 'success';
  error?: unknown;
}

function isSettledMiss(snapshot: OpportunityBidScoreSnapshot): boolean {
  const error = snapshot.error;
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  return (error as { status?: unknown }).status === 404;
}

export function opportunityBidScorePhase(
  snapshot: OpportunityBidScoreSnapshot,
): OpportunityBidScorePhase {
  const hasScore = snapshot.data != null;
  // isLoading is only true while the first fetch is in flight and nothing
  // has arrived. A paused first read is pending with isLoading false.
  if (snapshot.isLoading === true && !hasScore) return 'unread';
  if (isSettledMiss(snapshot)) return 'missing';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (hasScore) return 'ready';
  if (
    snapshot.status === 'pending' ||
    snapshot.isPending === true ||
    snapshot.fetchStatus === 'paused' ||
    snapshot.fetchStatus === 'fetching'
  ) {
    return 'unread';
  }
  return 'missing';
}
