/** Tasks the Slack today list draws. The query reads one past this page. */
export const SLACK_TASK_PAGE = 10;

const DAY_MS = 86_400_000;

/**
 * Inclusive start and exclusive end of today's UTC calendar day.
 * `due_date` is a date column. Local `setHours(0, 0, 0, 0)` follows the
 * server zone (America/Sao_Paulo is UTC-3), so a task due on today's UTC
 * day is missed after 21:00 in that zone and a task due tomorrow UTC is
 * included. The task list uses this same UTC day.
 */
export function slackTaskTodayWindow(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

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
