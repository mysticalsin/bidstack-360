// The follow-up record may say "not found" only after the list arrives
// without that id. A pause and an in-flight fetch have no payload yet.
// A failed read stays a failure.

export type TaskRecordPhase = 'unread' | 'failed' | 'missing' | 'ready';

export interface TaskRecordSnapshot {
  hasTask: boolean;
  hasPayload: boolean;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  status?: 'pending' | 'error' | 'success';
}

export function taskRecordPhase(snapshot: TaskRecordSnapshot): TaskRecordPhase {
  if (snapshot.hasTask) return 'ready';
  // isLoading is only true while the first fetch is in flight. A paused
  // first read is pending, with isLoading false and no list.
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  const noPayload = !snapshot.hasPayload;
  if (
    noPayload ||
    snapshot.isLoading === true ||
    snapshot.isPending === true ||
    snapshot.status === 'pending' ||
    snapshot.fetchStatus === 'paused' ||
    (snapshot.fetchStatus === 'fetching' && noPayload)
  ) {
    return 'unread';
  }
  return 'missing';
}
