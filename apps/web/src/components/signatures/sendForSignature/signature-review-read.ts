// The preview may look missing only after the document arrives.
// A pause has isLoading false and no payload. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type SignatureReviewPhase = 'unread' | 'failed' | 'ready';

export interface SignatureReviewSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function signatureReviewPhase(snapshot: SignatureReviewSnapshot): SignatureReviewPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
