// The proposal detail page may say "not found" only after a read settles
// without a record. A pause and an in-flight fetch have no payload yet.

export type ProposalRecordPhase = 'unread' | 'failed' | 'missing' | 'ready';

export interface ProposalRecordSnapshot {
  data?: unknown;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  status?: 'pending' | 'error' | 'success';
}

export function proposalRecordPhase(snapshot: ProposalRecordSnapshot): ProposalRecordPhase {
  const hasProposal = snapshot.data != null;
  // isLoading is only true while the first fetch is in flight and nothing
  // has arrived. A paused first read is pending with isLoading false.
  if (snapshot.isLoading === true && !hasProposal) return 'unread';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (hasProposal) return 'ready';
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
