// The opportunity detail page may say "not found" only after a read
// settles without a record. A pause and an in-flight fetch have no
// payload yet. A 404 is a settled miss. Any other error is a failed read.

import { ApiError } from '@/lib/api';

export type OpportunityRecordPhase = 'unread' | 'failed' | 'missing' | 'ready';

export interface OpportunityRecordSnapshot {
  data?: unknown;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  status?: 'pending' | 'error' | 'success';
  error?: unknown;
}

function isSettledMiss(snapshot: OpportunityRecordSnapshot): boolean {
  return snapshot.error instanceof ApiError && snapshot.error.status === 404;
}

export function opportunityRecordPhase(snapshot: OpportunityRecordSnapshot): OpportunityRecordPhase {
  const hasRecord = snapshot.data != null;
  // isLoading is only true while the first fetch is in flight and nothing
  // has arrived. A paused first read is pending with isLoading false.
  if (snapshot.isLoading === true && !hasRecord) return 'unread';
  if (isSettledMiss(snapshot)) return 'missing';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (hasRecord) return 'ready';
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
