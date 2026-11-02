/** Stages the list draws. The route reads one past this page. */
export const STAGE_LIST_PAGE = 100;

/**
 * Count on the stage list. The route reads one stage past this page and drops
 * it. A continued page is not every stage. A shorter page keeps the bare count.
 * No stage total is invented.
 */
export function stageListCaption(
  count: number,
  pageContinues: boolean,
  latest = STAGE_LIST_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every stage`;
  return String(count);
}
