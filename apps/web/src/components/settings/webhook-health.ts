/** Fields the webhook settings hero counts. A missing list is not this shape. */
export interface WebhookHealthSource {
  active: boolean;
  failureCount: number;
  events: readonly string[];
  lastDeliveryAt: string | null;
  lastFailureAt: string | null;
}

export interface WebhookHealthCounts {
  total: number;
  active: number;
  failing: number;
  eventCount: number;
  lastActivity: string | undefined;
}

/**
 * Counts for the webhook settings hero and the overview tile.
 * A list that has not arrived is not an empty book. Null keeps the panel
 * from saying All clear, None, or zero while the read is in flight or failed.
 * An empty array is a settled empty book and stays zero.
 */
export function webhookHealthCounts(
  subscriptions: readonly WebhookHealthSource[] | null | undefined,
): WebhookHealthCounts | null {
  if (!subscriptions) return null;
  const active = subscriptions.filter((subscription) => subscription.active).length;
  const failing = subscriptions.filter((subscription) => subscription.failureCount > 0).length;
  const eventCount = new Set(subscriptions.flatMap((subscription) => subscription.events)).size;
  const lastActivity = subscriptions
    .flatMap((subscription) => [subscription.lastDeliveryAt, subscription.lastFailureAt])
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return {
    total: subscriptions.length,
    active,
    failing,
    eventCount,
    lastActivity,
  };
}
