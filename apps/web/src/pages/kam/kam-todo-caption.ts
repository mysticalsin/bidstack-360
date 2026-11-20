/** Tasks the account to-do draws. The list reads one past this page. */
export const KAM_TODO_PAGE = 999;

/**
 * Caption on the key-account to-do. The route reads one task past this page
 * and drops it. A continued page is not every task. A shorter page keeps
 * "N open · M done". No task total is invented.
 */
export function kamTodoCaption(
  openCount: number,
  doneCount: number,
  pageContinues: boolean,
  latest: number,
): string {
  const counts = `${openCount} open · ${doneCount} done`;
  if (pageContinues) {
    return `${counts} in the latest ${latest}, not every task`;
  }
  return counts;
}

/** Empty to-do copy. A continued page has no open task in the drawn page. */
export function kamTodoEmptyMessage(pageContinues: boolean): string {
  if (pageContinues) {
    return `No open task in the latest ${KAM_TODO_PAGE}, not every task.`;
  }
  return "No open tasks across this account's initiatives.";
}
