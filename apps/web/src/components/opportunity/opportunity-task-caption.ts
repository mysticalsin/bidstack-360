/** Tasks the deal Tasks tab draws. The list route reads one row past this page. */
export const OPPORTUNITY_TASK_PAGE_LIMIT = 50;

/**
 * Deal task caption. A longer loaded list is the latest tasks, not every
 * task on the deal. No task total is invented.
 */
export function opportunityTaskCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${count} in the latest ${count}, not every task`;
  }
  return `${count} task`;
}
