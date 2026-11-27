import type { Task, TaskStatus } from '@bidstack/shared';

const STATUS_ORDER: Record<TaskStatus, number> = {
  open: 0,
  in_progress: 1,
  blocked: 2,
  done: 3,
};

/**
 * Order the loaded task page.
 *
 * `natural` is the Recent control. With no personal drag it is createdAt
 * descending. The list route returns due-date order, so leaving that page
 * untouched makes Recent and Due date the same list.
 *
 * `due` is the earliest due day first. A row with no due day stays last.
 * A personal drag applies only to Recent.
 */
export function orderTaskList(
  tasks: readonly Task[],
  sort: string,
  ordinalOf: (id: string) => number = () => Number.POSITIVE_INFINITY,
): Task[] {
  if (sort === 'natural') {
    const indexed = tasks.map((task, index) => ({ task, index }));
    indexed.sort((a, b) => {
      const left = ordinalOf(a.task.id);
      const right = ordinalOf(b.task.id);
      if (left !== right) return left - right;
      const byCreated = b.task.createdAt.localeCompare(a.task.createdAt);
      if (byCreated !== 0) return byCreated;
      if (a.index !== b.index) return a.index - b.index;
      return a.task.id.localeCompare(b.task.id);
    });
    return indexed.map((row) => row.task);
  }

  const next = [...tasks];
  if (sort === 'due') {
    next.sort((a, b) => compareDue(a, b));
    return next;
  }
  next.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  return next;
}

function compareDue(a: Task, b: Task): number {
  if (!a.dueDate && !b.dueDate) return compareCreated(a, b);
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  const byDue = a.dueDate.localeCompare(b.dueDate);
  if (byDue !== 0) return byDue;
  return compareCreated(a, b);
}

function compareCreated(a: Task, b: Task): number {
  const byCreated = b.createdAt.localeCompare(a.createdAt);
  if (byCreated !== 0) return byCreated;
  return a.id.localeCompare(b.id);
}
