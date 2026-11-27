// A document list may show an empty list only after the payload arrives.
// A pause has isLoading false and no rows. That read is still unread.
// A failure with no payload is not an empty list.

export type ReceiveDocumentsPhase = 'unread' | 'failed' | 'ready';

export interface ReceiveDocumentsReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function receiveDocumentsPhase(
  snapshot: ReceiveDocumentsReadSnapshot,
): ReceiveDocumentsPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
