// The new-agreement picker may list companies only after the account read arrives.
// A pause has isLoading false and no companies. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type AgreementAccountPhase = 'unread' | 'failed' | 'ready';

export interface AgreementAccountSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function agreementAccountPhase(snapshot: AgreementAccountSnapshot): AgreementAccountPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
