// Open-task counting for the nav badge and the Tasks page.
//
// These two functions still mirror the production split (the bug):
// - navigationBadgeCount: org-wide overdue, apps/api/src/routes/tasks.ts
//   buildTaskSummary (`status <> 'done' AND due_date < todayUtc`). The sidebar
//   reads that number (apps/web/src/components/layout/Sidebar.tsx).
// - tasksPageCount: every non-deleted task in the org, the GET /tasks list
//   whose length the Tasks page prints (apps/web/src/pages/TasksPage.tsx).
//
// `userId` is part of the signature because both call sites must share one
// "open tasks for this user" predicate. The implementations below ignore it,
// which is why a due-today task is listed and not badged.

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
  _userId: string,
  todayUtc: string,
): number {
  return rows.filter(
    (row) =>
      row.orgId === orgId &&
      row.deletedAt === null &&
      row.status !== 'done' &&
      row.dueDate !== null &&
      row.dueDate < todayUtc,
  ).length;
}

export function tasksPageCount(
  rows: readonly CountableTask[],
  orgId: string,
  _userId: string,
  _todayUtc: string,
): number {
  return rows.filter((row) => row.orgId === orgId && row.deletedAt === null).length;
}
