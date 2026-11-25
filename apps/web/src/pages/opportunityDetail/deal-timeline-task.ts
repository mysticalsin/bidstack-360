const OPEN_TASK = new Set(['open', 'in_progress', 'blocked']);

const TASK_ID =
  /^task-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Whole UTC days from the due day to today. Due today is 0, not late. */
function utcDaysLate(dueIso: string, now: Date): number | null {
  const due = new Date(dueIso);
  if (Number.isNaN(due.getTime())) return null;
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((nowDay - dueDay) / 86_400_000);
}

/**
 * Late clause for a task row on the deal activity timeline. An open,
 * in-progress, or blocked follow-up whose due day is before today (UTC) is
 * late. Due today, a future day, a finished follow-up, and a missing date
 * stay quiet. Other timeline kinds are not follow-ups.
 */
export function timelineTaskLateClause(
  kind: string,
  metadata: Record<string, unknown> | undefined,
  now: Date,
): string | null {
  if (kind !== 'task' || !metadata) return null;
  const status = metadata.status;
  if (typeof status !== 'string' || !OPEN_TASK.has(status)) return null;
  const due = metadata.dueDate;
  if (typeof due !== 'string' || due.length === 0) return null;
  const late = utcDaysLate(due, now);
  if (late == null || late <= 0) return null;
  return `Overdue: ${late}d late.`;
}

/** Task record for a timeline row id `task-<uuid>`. Other kinds stay text. */
export function timelineTaskHref(id: string, kind: string): string | null {
  if (kind !== 'task') return null;
  const match = TASK_ID.exec(id);
  if (!match?.[1]) return null;
  return `/tasks/${match[1]}`;
}
