/** Territory rows the list draws. The route reads one past this page. */
export const TERRITORY_LIST_PAGE = 500;

/**
 * Caption on the territory list. The route reads one territory past this page
 * and drops it. A continued page is not every territory. A shorter page keeps
 * "N total". No territory total is invented.
 */
export function territoryListCaption(
  count: number,
  pageContinues: boolean,
  latest: number,
): string {
  if (pageContinues) {
    return `${count} in the latest ${latest}, not every territory`;
  }
  return `${count} total`;
}
