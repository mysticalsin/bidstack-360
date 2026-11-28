import { daysUntilDueUtc } from '@/components/ui/DueDateChip';

/**
 * Whole UTC days a follow-up is late, or null when it is not.
 *
 * dueDate is a calendar day. Elapsed milliseconds would call today late after
 * noon. A finished follow-up is done, not late. Matches the tasks list clock.
 */
export function openFollowUpLateDays(
  dueDate: string | null,
  status: string,
  now: Date = new Date(),
): number | null {
  if (!dueDate || status === 'done') return null;
  const days = daysUntilDueUtc(dueDate, now);
  if (days >= 0) return null;
  return Math.abs(days);
}
