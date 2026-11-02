/** Keys the list draws. The route reads one past this page. */
export const API_KEY_LIST_PAGE = 500;

/**
 * Count on the API-key list. The route reads one key past this page and drops
 * it. A continued page is not every key. A shorter page keeps the bare count.
 * No key total is invented.
 */
export function apiKeyListCaption(
  count: number,
  pageContinues: boolean,
  latest = API_KEY_LIST_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every key`;
  return String(count);
}
