/** Counts in one delivery stats window. Pending retries are not settled. */
export interface WebhookDeliveryWindow {
  succeeded: number;
  failed: number;
  pending: number;
}

export type WebhookDeliveryHealth =
  | { kind: 'empty' }
  | { kind: 'retrying'; pending: number }
  | { kind: 'settled'; failed: number; settled: number; pending: number };

/**
 * How the deliveries tab should read a stats window.
 * A null success rate is not an empty book when retries are still in flight.
 * A settled rate keeps those retries in view so 100% of settled messages is
 * not a clear window.
 * A window with no successes, failures, or retries stays empty.
 */
export function webhookDeliveryHealth(window: WebhookDeliveryWindow): WebhookDeliveryHealth {
  const succeeded = window.succeeded;
  const failed = window.failed;
  const pending = window.pending;
  const settled = succeeded + failed;
  if (settled === 0 && pending > 0) return { kind: 'retrying', pending };
  if (settled === 0) return { kind: 'empty' };
  return { kind: 'settled', failed, settled, pending };
}
