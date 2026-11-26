// An opened thread may say it failed only after the read fails. A pause has
// isLoading false and no messages. That read is still unread. A payload that
// arrived with no thread is a failed load, not a thread that is still due.

export type EmailThreadPhase = 'unread' | 'failed' | 'ready';

export interface EmailThreadReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function emailThreadPhase(snapshot: EmailThreadReadSnapshot): EmailThreadPhase {
  if (snapshot.data != null) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error' || snapshot.status === 'success') {
    return 'failed';
  }
  return 'unread';
}
