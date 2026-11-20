/** Tags the library draws. The route reads one past this page. */
export const TAG_LIBRARY_PAGE = 250;

/**
 * Count on the tag library. The route reads one tag past this page and drops
 * it. A continued page is not every tag. A shorter page keeps the bare count.
 * No tag total is invented.
 */
export function tagLibraryCaption(
  count: number,
  pageContinues: boolean,
  latest = TAG_LIBRARY_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every tag`;
  return String(count);
}
