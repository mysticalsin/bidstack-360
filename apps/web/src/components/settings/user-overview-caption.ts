/** Users the workspace tile counts. GET /users already reads one past this page. */
export const USER_OVERVIEW_PAGE = 100;

/**
 * Count on the workspace tile. GET /users reads one user past this page and
 * drops it (`nextCursor`). A continued page is not every user. A shorter page
 * keeps the bare count. No user total is invented.
 */
export function userOverviewCaption(
  count: number,
  pageContinues: boolean,
  latest = USER_OVERVIEW_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every user`;
  return String(count);
}
