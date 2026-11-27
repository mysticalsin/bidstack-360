// Mail filed on a contact may say "No email yet" only after the payload arrives.
// A pause has isLoading false and no rows. That read is still unread. A failure
// with no payload is not an empty mailbox.

export type EmailListPhase = 'unread' | 'failed' | 'ready';

export interface EmailListReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function emailListPhase(snapshot: EmailListReadSnapshot): EmailListPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
