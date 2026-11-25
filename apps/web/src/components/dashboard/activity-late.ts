import { daysUntilDueUtc } from '@/components/ui/DueDateChip';

export interface ActivityClock {
  type: string;
  /** Task status or opportunity stage, as the summary stores it. */
  subtitle: string | null;
  dueDate?: string | null;
}

const DECIDED_STAGES = new Set(['closed_won', 'closed_lost']);

/**
 * Whole UTC days a dashboard activity row is already late.
 * Null when the row has no due date, is not a bid or follow-up, is already
 * decided or done, or is due today or later. Due today is not late: the
 * UTC day still has time left.
 */
export function activityLateDays(item: ActivityClock, now: Date = new Date()): number | null {
  if (!item.dueDate) return null;
  const status = (item.subtitle ?? '').toLowerCase();
  if (item.type === 'task') {
    if (status === 'done') return null;
  } else if (item.type === 'opportunity') {
    if (DECIDED_STAGES.has(status)) return null;
  } else {
    return null;
  }
  const days = daysUntilDueUtc(item.dueDate, now);
  return days < 0 ? Math.abs(days) : null;
}
