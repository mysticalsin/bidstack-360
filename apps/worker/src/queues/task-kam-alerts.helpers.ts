// Pure due-detection + dedupe helpers for the task-due and KAM-staleness alert
// worker. Extracted so the day math and dedupe-key shape can be unit-tested
// without Postgres, Redis, or BullMQ (mirrors bid-deadline-alerts.helpers.ts).
//
// TZ ASSUMPTION (WHY UTC-day, not date-fns): both windows this worker checks
// are RELATIVE ("within 24h", "no activity in 14 days"), not calendar-anchored
// to a specific org's local midnight — a task due "tomorrow" or an initiative
// stale "since 14 days ago" reads the same regardless of which org/timezone
// owns it, so org-local-midnight precision is not required. date-fns is not a
// dependency of apps/worker (or anywhere in this workspace); Task.dueDate is a
// Postgres `date` (UTC midnight) like Opportunity.dueDate, so comparing on the
// UTC calendar day (Date.UTC arithmetic, same approach as
// bid-deadline-alerts.helpers.ts) is both correct and dependency-free.

/** Whole calendar days from `now` until `dueDate`, floored toward the deadline. */
export function daysUntilDue(dueDate: Date, now: Date): number {
  const MS_PER_DAY = 86_400_000;
  const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((dueDay - nowDay) / MS_PER_DAY);
}

/** Whole calendar days since `since` as of `now` (>= 0; `since` in the future returns 0). */
export function daysSince(since: Date, now: Date): number {
  return Math.max(0, -daysUntilDue(since, now));
}

/** A task is due-or-overdue when its deadline is today, tomorrow, or already past. */
export function isTaskDueOrOverdue(daysUntil: number): boolean {
  return daysUntil <= 1;
}

/** Default staleness window per docs/KAM-PLAN.md §5: no task activity in 14 days. */
export const KAM_STALE_THRESHOLD_DAYS = 14;

export function isInitiativeStale(
  daysSinceActivity: number,
  thresholdDays: number = KAM_STALE_THRESHOLD_DAYS,
): boolean {
  return daysSinceActivity >= thresholdDays;
}

/**
 * UTC calendar-day key (YYYY-MM-DD) — the "event-day" component of every
 * dedupe key below. WHY per-day (not once-ever like bid-deadline-alerts'
 * per-threshold key): these are ongoing nudges, not one-shot boundary alerts —
 * an overdue task or a still-stale initiative should re-nudge on each new day
 * it remains that way, but the scan can run more than once within the same
 * day, so same-day re-runs must never double-notify (alert fatigue = ignored
 * deadlines, the exact failure this dedupe key prevents).
 */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Deterministic per-(task, day) dedupe marker, carried in Notification.url. */
export function taskDueDedupeUrl(taskId: string, dayKey: string): string {
  return `/tasks?taskId=${taskId}&due=${dayKey}`;
}

/** Deterministic per-(initiative, day) dedupe marker, carried in Notification.url. */
export function initiativeStaleDedupeUrl(initiativeId: string, dayKey: string): string {
  return `/kam?initiative=${initiativeId}&stale=${dayKey}`;
}
