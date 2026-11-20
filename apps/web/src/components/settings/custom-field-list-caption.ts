/** Fields the list draws. The route reads one past this page. */
export const CUSTOM_FIELD_LIST_PAGE = 500;

/**
 * Count on the custom-field list. The route reads one field past this page
 * and drops it. A continued page is not every field. A shorter page keeps the
 * bare count. No field total is invented.
 */
export function customFieldListCaption(
  count: number,
  pageContinues: boolean,
  latest = CUSTOM_FIELD_LIST_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every field`;
  return String(count);
}
