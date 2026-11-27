const DAY_MS = 86_400_000;

/**
 * Open fixture tasks and the absolute due dates `fixtureTasks` writes.
 * A done task is not here: that date is history.
 * The workload overdue count reads this copy, so a restored May date does
 * not mark a desk over capacity.
 */
export const FIXTURE_WORKLOAD_TASK_DUE: Readonly<Record<string, string>> = {
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

function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Days to add so the earliest seeded open task lands on tomorrow.
 * Zero while that date is still today or later.
 */
function fixtureWorkloadTaskShiftDays(now: Date): number {
  const earliest = utcDayMs(EARLIEST_SEEDED_DUE);
  const today = utcDayMs(now);
  if (earliest == null || today == null || earliest >= today) return 0;
  return Math.round((today + DAY_MS - earliest) / DAY_MS);
}

export interface FixtureWorkloadTaskDueRow {
  id: string;
  status?: string | null;
  dueDate: Date | string;
}

/**
 * In demo, slide an open fixture task that still holds its seeded due date
 * forward with the rest of that set. Anything else is returned as given.
 * The input date is not changed.
 */
export function projectFixtureWorkloadTaskDue<T extends Date | string>(
  row: FixtureWorkloadTaskDueRow & { dueDate: T },
  now: Date,
  mode: string | undefined,
): T {
  if (mode !== 'demo' || row.status === 'done') return row.dueDate;
  const seeded = FIXTURE_WORKLOAD_TASK_DUE[row.id];
  if (!seeded) return row.dueDate;
  const stored = utcDayMs(row.dueDate);
  const seededMs = utcDayMs(seeded);
  if (stored == null || seededMs == null || stored !== seededMs) return row.dueDate;
  const shift = fixtureWorkloadTaskShiftDays(now);
  if (shift === 0) return row.dueDate;
  const next = dayString(seededMs + shift * DAY_MS);
  return (typeof row.dueDate === 'string' ? next : new Date(`${next}T00:00:00.000Z`)) as T;
}

/**
 * Fixture rows whose seeded date projects onto today or later.
 * The workload overdue query leaves these out, matched on id and stored date,
 * so a live task and an edited fixture date still count.
 * Real mode, and a demo whose seeded dates are still ahead, returns none.
 */
export function fixtureWorkloadTasksNotOverdue(
  now: Date,
  mode: string | undefined,
): Array<{ id: string; dueDate: Date }> {
  if (mode !== 'demo' || fixtureWorkloadTaskShiftDays(now) === 0) return [];
  const today = utcDayMs(now);
  if (today == null) return [];
  const held: Array<{ id: string; dueDate: Date }> = [];
  for (const [id, date] of Object.entries(FIXTURE_WORKLOAD_TASK_DUE)) {
    const stored = new Date(`${date}T00:00:00.000Z`);
    const projected = projectFixtureWorkloadTaskDue(
      { id, status: 'open', dueDate: stored },
      now,
      'demo',
    );
    const projectedMs = utcDayMs(projected);
    if (projectedMs != null && projectedMs >= today) held.push({ id, dueDate: stored });
  }
  return held;
}
