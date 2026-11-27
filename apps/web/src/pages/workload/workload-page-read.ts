// The team workload page may say "No live bids on any desk" only after the
// payload arrives. A pause has isLoading false and no owners. That read is
// still unread. A failure with no payload is not an empty team. A payload
// already in hand stays, including when a later refresh fails.

export type WorkloadPagePhase = 'unread' | 'failed' | 'ready';

export interface WorkloadPageRead {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function workloadPagePhase(snapshot: WorkloadPageRead): WorkloadPagePhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
