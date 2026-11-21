import { civilDay } from '@bidstack/shared';

// Open-task counting for the nav badge and the Tasks page.
//
// One predicate — openTasksForUserWhere — decides membership. The badge count
// and the Tasks page count both filter with isOpenTaskForUser, which reads
// that where-clause. Due date is not part of the predicate: a task due on the
// UTC day (which formatDate used to render as the previous evening in
// America/Sao_Paulo) is still open work. `todayUtc` stays on the count
// signatures so callers can pass the clock; it does not change membership.

export type CountableTaskStatus = 'open' | 'in_progress' | 'blocked' | 'done';

export interface CountableTask {
  orgId: string;
  assigneeId: string | null;
  status: CountableTaskStatus;
  /** Calendar date YYYY-MM-DD, or null when the task has no due date. */
  dueDate: string | null;
  deletedAt: string | null;
}

/** The single membership rule both surfaces have to apply. */
export function openTasksForUserWhere(orgId: string, userId: string): {
  orgId: string;
  assigneeId: string;
  deletedAt: null;
  status: { not: 'done' };
} {
  return {
    orgId,
    assigneeId: userId,
    deletedAt: null,
    status: { not: 'done' },
  };
}

/**
 * Day the summary compares due dates against: `civilDay` in the org timezone.
 * 2026-11-21T01:00:00Z is 22:00 on Nov 20 in America/Sao_Paulo, so a task due
 * Nov 20 is due today, not overdue.
 */
export function taskSummaryToday(now: Date, orgTimeZone?: string | null): string {
  return civilDay(now, orgTimeZone);
}

export function isOpenTaskForUser(row: CountableTask, orgId: string, userId: string): boolean {
  const where = openTasksForUserWhere(orgId, userId);
  return (
    row.orgId === where.orgId &&
    row.assigneeId === where.assigneeId &&
    row.deletedAt === where.deletedAt &&
    row.status !== where.status.not
  );
}

export function navigationBadgeCount(
  rows: readonly CountableTask[],
  orgId: string,
  userId: string,
  _todayUtc: string,
): number {
  return rows.filter((row) => isOpenTaskForUser(row, orgId, userId)).length;
}

export function tasksPageCount(
  rows: readonly CountableTask[],
  orgId: string,
  userId: string,
  todayUtc: string,
): number {
  return navigationBadgeCount(rows, orgId, userId, todayUtc);
}
