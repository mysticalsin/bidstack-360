// The contact detail page may say "not found" only after a read settles
// without a person. A pause and an in-flight fetch have no payload yet.

export type ContactRecordPhase = 'unread' | 'failed' | 'missing' | 'ready';

export interface ContactRecordSnapshot {
  data?: unknown;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  status?: 'pending' | 'error' | 'success';
}

export function contactRecordPhase(snapshot: ContactRecordSnapshot): ContactRecordPhase {
  const hasPerson = snapshot.data != null;
  // isLoading is only true while the first fetch is in flight and nothing
  // has arrived. A paused first read is pending with isLoading false.
  if (snapshot.isLoading === true && !hasPerson) return 'unread';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (hasPerson) return 'ready';
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
