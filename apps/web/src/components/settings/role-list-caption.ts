/** Roles the list draws. The route reads one past this page. */
export const ROLE_LIST_PAGE = 500;

/**
 * Count on the role list. The route reads one role past this page and drops
 * it. A continued page is not every role. A shorter page keeps the bare count.
 * No role total is invented.
 */
export function roleListCaption(
  count: number,
  pageContinues: boolean,
  latest = ROLE_LIST_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every role`;
  return String(count);
}
