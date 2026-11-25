// A follow-up on the People tab opens its record only through the task id.
// The title is not an address: a search on it can match a different
// follow-up. A script, a path, or a blank stays text.

const TASK_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Follow-up page for this task, or null when the id is not a uuid. */
export function taskRecordHref(taskId: string | null | undefined): string | null {
  if (!taskId || !TASK_ID.test(taskId)) return null;
  return `/tasks/${taskId}`;
}
