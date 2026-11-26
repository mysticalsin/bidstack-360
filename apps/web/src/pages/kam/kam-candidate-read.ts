// The designate dialog may list companies only after the candidate read arrives.
// A pause has isLoading false and no rows. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type KamCandidatePhase = 'unread' | 'failed' | 'ready';

export interface KamCandidateSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function kamCandidatePhase(snapshot: KamCandidateSnapshot): KamCandidatePhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
