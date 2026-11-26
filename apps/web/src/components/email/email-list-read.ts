// The mailbox may list threads only after the read arrives.
// A pause has isLoading false and no pages. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type EmailListPhase = 'unread' | 'failed' | 'ready';

export interface EmailListSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function emailListPhase(snapshot: EmailListSnapshot): EmailListPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
