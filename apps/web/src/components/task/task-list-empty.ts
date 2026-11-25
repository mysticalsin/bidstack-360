import { daysUntil } from '@/lib/format';

export interface FollowUpTiming {
  dueDate: string | null;
  status: string;
}

/**
 * A loaded row the Overdue chip would keep.
 * Uses the same `daysUntil` clock as the tasks list, so Today and this hint
 * cannot disagree about which follow-up is late.
 */
export function isLateOpenFollowUp(task: FollowUpTiming): boolean {
  if (task.status === 'done') return false;
  const days = daysUntil(task.dueDate);
  return days !== null && days < 0;
}

/**
 * Today is not a server filter. The loaded page still holds the other
 * follow-ups. An empty Today view that still has late rows is those rows,
 * not an empty book. Any other filter, or a Today view that already has a
 * row, is not this case.
 */
export function lateCountWhenTodayIsEmpty(
  filter: string,
  visibleCount: number,
  loaded: readonly FollowUpTiming[],
): number {
  if (filter !== 'today' || visibleCount !== 0) return 0;
  return loaded.filter(isLateOpenFollowUp).length;
}

/**
 * Quick-add files an open follow-up. On an empty Today, Overdue, or status
 * view that row is not in the filter, so the form reads as a failed save.
 * All and Open show it. A filter that already lists rows keeps it.
 */
export function showQuickAdd(filter: string, visibleCount: number): boolean {
  if (filter === 'all' || filter === 'open') return true;
  return visibleCount > 0;
}
