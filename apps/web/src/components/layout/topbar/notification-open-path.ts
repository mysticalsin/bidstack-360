const TASK_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Where a notification row should open.
 *
 * The task-due scan stores `/tasks?taskId=<id>&due=<day>` as its dedupe
 * marker. The tasks list reads filter, sort, and view, so that query never
 * selects the follow-up. A uuid task id on that exact path opens the record.
 * Every other URL is left as the server sent it.
 */
export function notificationOpenPath(url: string | null): string | null {
  if (url === null || !url.startsWith('/')) return url;
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://bell.local');
  } catch {
    return url;
  }
  if (parsed.origin !== 'http://bell.local' || parsed.pathname !== '/tasks') return url;
  const taskId = parsed.searchParams.get('taskId');
  if (!taskId || !TASK_ID.test(taskId)) return url;
  const due = parsed.searchParams.get('due');
  const record = `/tasks/${taskId}`;
  return due && DUE_DAY.test(due) ? `${record}?due=${due}` : record;
}
