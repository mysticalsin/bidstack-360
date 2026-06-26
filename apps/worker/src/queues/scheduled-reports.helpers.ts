// Pure due-detection helper for the scheduled-reports worker.
//
// AnalyticsReport.schedule is a free-form string (packages/shared analytics.ts:
// `z.string().max(255)`) with no semantics defined anywhere in the codebase —
// the UI displays it verbatim but never drove execution. We give it a small,
// explicit vocabulary here (the worker is the first consumer). Anything outside
// the vocabulary is treated as "not scheduled" so a stray value never triggers
// runaway runs.
//
// Mirrors the cadence model of workflow-schedule.ts (everyMinutes), adding the
// human cadences the report UI implies (daily / weekly / monthly).

/** Scan cadence — keep in sync with the repeatable registration in the worker. */
export const SCHEDULED_REPORTS_SCAN_INTERVAL_MINUTES = 60;

const MINUTES_PER_DAY = 1440;

/**
 * Resolve a schedule string to its cadence in minutes, or null when the value
 * is empty / unrecognized (→ "not scheduled", skip).
 *
 * Accepted, case-insensitive:
 *   - 'daily'   → 1 day
 *   - 'weekly'  → 7 days
 *   - 'monthly' → 30 days (calendar-month drift is acceptable for a digest)
 *   - 'everyMinutes:N' → N minutes (ops/testing escape hatch), clamped to the
 *     scan interval so a small N can never busy-loop the scan.
 */
export function cadenceMinutes(schedule: string | null | undefined): number | null {
  if (!schedule) return null;
  const value = schedule.trim().toLowerCase();
  switch (value) {
    case 'daily':
      return MINUTES_PER_DAY;
    case 'weekly':
      return MINUTES_PER_DAY * 7;
    case 'monthly':
      return MINUTES_PER_DAY * 30;
    default: {
      const match = /^everyminutes:(\d+)$/.exec(value);
      if (!match) return null;
      const raw = Number(match[1]);
      if (!Number.isFinite(raw) || raw <= 0) return null;
      return Math.max(raw, SCHEDULED_REPORTS_SCAN_INTERVAL_MINUTES);
    }
  }
}

/**
 * A scheduled report is due when its schedule resolves to a cadence and it has
 * either never run or last ran at least one cadence ago.
 *
 * `schedule` semantics live in cadenceMinutes; an unrecognized schedule yields
 * null there and is never due. Pure so idempotency (no double-run within a
 * cadence) is unit-testable without the DB.
 */
export function isReportDue(
  schedule: string | null | undefined,
  lastRunAt: Date | null,
  now: Date,
): boolean {
  const cadence = cadenceMinutes(schedule);
  if (cadence === null) return false;
  if (!lastRunAt) return true;
  const elapsedMs = now.getTime() - lastRunAt.getTime();
  return elapsedMs >= cadence * 60_000;
}
