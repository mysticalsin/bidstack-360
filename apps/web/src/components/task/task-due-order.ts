import type { TaskStatus } from '@bidstack/shared';

export interface DueSortableTask {
  dueDate: string | null;
  status: TaskStatus;
}

/**
 * Due date answers which follow-up still needs a day. A finished row keeps
 * its due day, but it must not lead the open book: the demo handover is
 * already done and dated before the open annex.
 * Unfinished rows come first, earliest day first, missing day last in that
 * group. Finished rows follow, with the same day rules.
 */
export function compareTasksByDue(a: DueSortableTask, b: DueSortableTask): number {
  const aFinished = a.status === 'done' ? 1 : 0;
  const bFinished = b.status === 'done' ? 1 : 0;
  if (aFinished !== bFinished) return aFinished - bFinished;
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  if (a.dueDate === b.dueDate) return 0;
  return a.dueDate < b.dueDate ? -1 : 1;
}

export function sortTasksByDue<T extends DueSortableTask>(tasks: readonly T[]): T[] {
  return [...tasks].sort(compareTasksByDue);
}
