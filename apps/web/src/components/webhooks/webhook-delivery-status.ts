export type WebhookDeliveryStatusCopy =
  | { kind: 'no-response' }
  | { kind: 'http'; statusCode: number };

/**
 * Status words for one delivery-history row.
 * A null status code is not a timeout. The worker stores null for an unsafe
 * URL, a policy denial, a decrypt failure, and a dropped connection. The
 * error text stays on the row. This copy only names an HTTP status, or that
 * none came back.
 */
export function webhookDeliveryStatusCopy(statusCode: number | null): WebhookDeliveryStatusCopy {
  if (statusCode === null) return { kind: 'no-response' };
  return { kind: 'http', statusCode };
}
