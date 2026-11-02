/** Groups the list draws. The route reads one past this page. */
export const ACCESS_GROUP_LIST_PAGE = 100;

/**
 * Count on the access-group list. The route reads one group past this page
 * and drops it. A continued page is not every group. A shorter page keeps
 * the bare count. No group total is invented.
 */
export function accessGroupListCaption(
  count: number,
  pageContinues: boolean,
  latest = ACCESS_GROUP_LIST_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every group`;
  return String(count);
}
