// The retry editor may show a schedule only after the read arrives.
// A pause has isLoading false and no policy. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type WebhookRetryReadPhase = 'unread' | 'failed' | 'ready';

export interface WebhookRetryReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function webhookRetryReadPhase(snapshot: WebhookRetryReadSnapshot): WebhookRetryReadPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
