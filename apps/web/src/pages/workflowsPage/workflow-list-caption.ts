/** Workflows the list draws. The route reads one past this page. */
export const WORKFLOW_LIST_PAGE = 50;

/**
 * Count on the workflow list. The route reads one workflow past this page
 * and drops it. A continued page is not every workflow. A shorter page keeps
 * "N workflow" / "N workflows". No workflow total is invented.
 */
export function workflowListCaption(
  count: number,
  pageContinues: boolean,
  latest = WORKFLOW_LIST_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every workflow`;
  return count === 1 ? `${count} workflow` : `${count} workflows`;
}
