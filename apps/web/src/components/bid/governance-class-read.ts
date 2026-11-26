// The classification form may offer gates only after the saved record arrives.
// A pause has isLoading false and no payload. That read is still unread.
// A caller that already passed the saved assessment skips this read.
// Error wins, then undefined data is unread, else the read is ready.

export type GovernanceClassPhase = 'skip' | 'unread' | 'failed' | 'ready';

export interface GovernanceClassSnapshot {
  opportunityId?: string;
  saved?: unknown;
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function governanceClassPhase(snapshot: GovernanceClassSnapshot): GovernanceClassPhase {
  if (snapshot.saved != null || !snapshot.opportunityId) return 'skip';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
