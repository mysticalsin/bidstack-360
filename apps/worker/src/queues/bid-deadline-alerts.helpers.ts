// Pure due-detection + dedupe helpers for the bid-deadline alert worker.
//
// Extracted from the worker so the threshold maths and the per-(opp, threshold)
// dedupe key can be unit-tested without Postgres, Redis, or BullMQ. The worker
// (bid-deadline-alerts.ts) supplies the org-scoped I/O around these.

/**
 * Alert thresholds, in days-before-due. Order matters: closest deadline first so
 * a notification's copy reflects the most-urgent crossed boundary, and the
 * dedupe key is per-threshold (an opp legitimately gets a 7d, then 3d, then 1d
 * alert — never two of the same).
 */
export const DEADLINE_THRESHOLD_DAYS = [7, 3, 1] as const;

export type DeadlineThresholdDay = (typeof DEADLINE_THRESHOLD_DAYS)[number];

/**
 * Whole calendar days from `now` until `dueDate`, floored toward the deadline.
 *
 * dueDate is a Postgres `date` (midnight UTC). We compare on the UTC day so the
 * result is stable regardless of the worker's local zone — a deadline "today"
 * is 0, "tomorrow" is 1. Negative means the deadline has already passed.
 */
export function daysUntilDue(dueDate: Date, now: Date): number {
  const MS_PER_DAY = 86_400_000;
  const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((dueDay - nowDay) / MS_PER_DAY);
}

/**
 * The thresholds an opportunity has CROSSED as of `now`: every threshold whose
 * window the deadline now falls inside (daysUntil <= threshold) and that is not
 * already past (daysUntil >= 0). Ordered widest-first, so the nearest is last
 * (`.at(-1)`).
 *
 * NOTE: the worker does NOT emit this whole set. `nearestCrossedThreshold` picks
 * only the nearest crossed bucket (see its doc) so an opp first seen deep inside
 * the window gets one accurate alert, not 7d+3d+1d at once. Tradeoff: with no
 * backfill, worker downtime spanning a boundary skips that boundary by design.
 * An already-overdue opp (daysUntil < 0) returns none.
 */
export function thresholdsFor(daysUntil: number): DeadlineThresholdDay[] {
  if (daysUntil < 0) return [];
  return DEADLINE_THRESHOLD_DAYS.filter((t) => daysUntil <= t);
}

/**
 * The single NEAREST threshold an opportunity has crossed as of `now`, or null
 * when none (overdue, or further out than the widest window). The worker alerts
 * on this bucket only — emitting every crossed bucket at once (e.g. an opp first
 * seen already due tomorrow) would fire 7d+3d+1d simultaneously. Because
 * daysUntil only decreases, a later scan crossing into a tighter bucket fires
 * that bucket via its own dedupe key, giving the intended 7→3→1 cadence with one
 * alert per boundary.
 */
export function nearestCrossedThreshold(daysUntil: number): DeadlineThresholdDay | null {
  const crossed = thresholdsFor(daysUntil);
  const last = crossed[crossed.length - 1];
  return last ?? null;
}

/**
 * Deterministic dedupe marker for a single (opportunity, threshold) alert,
 * carried in Notification.url (which doubles as the deep-link). Because it is a
 * pure function of the two ids, an existence check on this exact string makes
 * re-alerting the same boundary impossible across scans — without a schema
 * marker column or a migration.
 */
export function deadlineDedupeUrl(opportunityId: string, thresholdDays: number): string {
  return `/opportunities/${opportunityId}?deadline=${thresholdDays}`;
}

/**
 * Human label for the REAL days-until-due, used in alert copy. Driven by the
 * actual remaining days (not the bucket boundary) so a deduped alert never states
 * a day count the opportunity has already passed. 0 / negative collapse to
 * 'today' (a due-today opp should not read "in 0 days").
 */
export function dueInLabel(daysUntil: number): string {
  if (daysUntil <= 0) return 'today';
  if (daysUntil === 1) return 'in 1 day';
  return `in ${daysUntil} days`;
}
