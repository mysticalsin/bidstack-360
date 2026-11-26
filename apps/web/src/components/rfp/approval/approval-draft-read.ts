// The review gate may look settled only after the draft arrives.
// A pause has isLoading false and no proposal. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type ApprovalDraftPhase = 'unread' | 'failed' | 'ready';

export interface ApprovalDraftSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function approvalDraftPhase(snapshot: ApprovalDraftSnapshot): ApprovalDraftPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
