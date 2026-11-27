// Demo-only read clock for the task-due alert scan.
// Open fixture tasks store absolute due dates (2026-05-12 through 2026-05-23).
// The scan compares those stored dates with today, so on a later clock every
// one of them is overdue: the assignee gets an overdue nudge, and the May rows
// sort first inside the 1000-row batch. This slides a still-seeded open row
// so the earliest of that set is tomorrow. The gaps stay. The stored row is
// not written. Real mode, and any mode other than exact `demo`, is unchanged.

const DAY_MS = 86_400_000;

/**
 * Open fixture tasks and the absolute due dates `fixtureTasks` writes.
 * A done task is not here: that date is history.
 */
export const FIXTURE_TASK_ALERT_DUE_DATES: Readonly<Record<string, string>> = {
  '00000000-0000-4000-8000-000000010001': '2026-05-15',
  '00000000-0000-4000-8000-000000010002': '2026-05-20',
  '00000000-0000-4000-8000-000000010003': '2026-05-12',
  '00000000-0000-4000-8000-000000010004': '2026-05-21',
  '00000000-0000-4000-8000-000000010005': '2026-05-23',
  '00000000-0000-4000-8000-000000010006': '2026-05-12',
  '00000000-0000-4000-8000-000000010007': '2026-05-19',
};

const EARLIEST_SEEDED_DUE = '2026-05-12';

function utcDayMs(value: Date | string): number | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Days to add so the earliest seeded open task lands on tomorrow. Zero while that date is still today or later. */
function fixtureTaskAlertShiftDays(now: Date): number {
  const earliest = utcDayMs(EARLIEST_SEEDED_DUE);
  const today = utcDayMs(now);
  if (earliest == null || today == null || earliest >= today) return 0;
  return Math.round((today + DAY_MS - earliest) / DAY_MS);
}

export interface FixtureTaskAlertDueRow {
  id: string;
  status?: string | null;
  dueDate: Date;
}

/**
 * In demo, slide an open fixture task that still holds its seeded due date
 * forward with the rest of that set. Anything else is the same Date.
 * The input date is not changed.
 */
export function projectFixtureTaskAlertDue(
  row: FixtureTaskAlertDueRow,
  now: Date,
  mode: string | undefined,
): Date {
  if (mode !== 'demo' || row.status === 'done') return row.dueDate;
  const seeded = FIXTURE_TASK_ALERT_DUE_DATES[row.id];
  if (!seeded) return row.dueDate;
  const stored = utcDayMs(row.dueDate);
  const seededMs = utcDayMs(seeded);
  if (stored == null || seededMs == null || stored !== seededMs) return row.dueDate;
  const shift = fixtureTaskAlertShiftDays(now);
  if (shift === 0) return row.dueDate;
  return new Date(seededMs + shift * DAY_MS);
}

/**
 * Fixture rows whose seeded date projects past the scan window (tomorrow).
 * The query leaves them out so they do not occupy the front of the batch.
 * Real mode, and a demo whose seeded dates are still ahead, returns none.
 */
export function fixtureTasksOutsideAlertWindow(
  now: Date,
  mode: string | undefined,
): Array<{ id: string; dueDate: Date }> {
  if (mode !== 'demo' || fixtureTaskAlertShiftDays(now) === 0) return [];
  const today = utcDayMs(now);
  if (today == null) return [];
  const windowEnd = today + DAY_MS;
  const outside: Array<{ id: string; dueDate: Date }> = [];
  for (const [id, date] of Object.entries(FIXTURE_TASK_ALERT_DUE_DATES)) {
    const stored = new Date(`${date}T00:00:00.000Z`);
    const projected = projectFixtureTaskAlertDue({ id, dueDate: stored }, now, 'demo');
    if (projected.getTime() > windowEnd) outside.push({ id, dueDate: stored });
  }
  return outside;
}
