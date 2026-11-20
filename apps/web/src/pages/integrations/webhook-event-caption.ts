/** Events the integrations list draws. The route reads one past this page. */
export const WEBHOOK_EVENT_PAGE = 50;

/**
 * Count on the webhook-event list. The route reads one event past this page
 * and drops it. A continued page is not every event. A shorter page keeps the
 * bare count. No event total is invented.
 */
export function webhookEventCaption(
  count: number,
  pageContinues: boolean,
  latest = WEBHOOK_EVENT_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every event`;
  return String(count);
}
