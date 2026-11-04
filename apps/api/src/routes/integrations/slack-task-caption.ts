/** Tasks the Slack today list draws. The query reads one past this page. */
export const SLACK_TASK_PAGE = 10;

/**
 * Heading on `/bidstack tasks today`. The command loads one task past this
 * page and drops it. A continued page is not every task due today. A shorter
 * page keeps the old "Your tasks today (N)" heading. No task total is invented.
 */
export function slackTaskTodayHeading(
  count: number,
  pageContinues: boolean,
  latest = SLACK_TASK_PAGE,
): string {
  if (pageContinues) return `${count} in the latest ${latest}, not every task`;
  return `Your tasks today (${count})`;
}
