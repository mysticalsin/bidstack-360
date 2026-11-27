// The integrations hero may count webhook events only after the read arrives.
// invoice.sent and invoice.paid still ride this list after invoicing was removed.
// A pause has isLoading false and no page. That read is still unread.
// Error wins, then undefined data is unread, else the read is ready.

export type WebhookEventsPhase = 'unread' | 'failed' | 'ready';

export interface WebhookEventsSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function webhookEventsPhase(snapshot: WebhookEventsSnapshot): WebhookEventsPhase {
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  if (snapshot.data === undefined) return 'unread';
  return 'ready';
}
