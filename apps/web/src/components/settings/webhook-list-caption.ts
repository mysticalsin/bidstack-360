/** Webhooks the list draws. The route reads one past this page. */
export const WEBHOOK_LIST_PAGE = 500;

/**
 * Count on the webhook list. The route reads one webhook past this page and
 * drops it. A continued page is not every webhook. A shorter page keeps the
 * bare count. No webhook total is invented.
 */
export function webhookListCaption(
  count: number,
  pageContinues: boolean,
  latest = WEBHOOK_LIST_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every webhook`;
  return String(count);
}
