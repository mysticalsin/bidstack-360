const DAY_MS = 86_400_000;

/**
 * Open fixture deals and the absolute due dates `fixtureOpps` writes.
 * Closed seed deals are not here: those dates are history.
 */
export const FIXTURE_OPEN_DUE_DATES: Readonly<Record<string, string>> = {
  'OP-2043': '2026-06-30',
  'OP-2041': '2026-07-22',
  'OP-2045': '2026-08-01',
  'OP-2042': '2026-08-15',
  'OP-2048': '2026-09-15',
  'OP-2044': '2026-09-30',
};

const EARLIEST_SEEDED_DUE = '2026-06-30';
const CLOSED = new Set(['closed_won', 'closed_lost']);

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
 * Days to add so the earliest seeded open due date lands on tomorrow.
 * Zero while that date is still today or later.
 */
export function fixtureOpenShiftDays(now: Date): number {
  const earliest = utcDayMs(EARLIEST_SEEDED_DUE);
  const today = utcDayMs(now);
  if (earliest == null || today == null || earliest >= today) return 0;
  return Math.round((today + DAY_MS - earliest) / DAY_MS);
}

export interface FixtureOpportunityDueRow {
  code: string;
  stage?: string | null;
  dueDate: Date | string | null;
  pipelineStage?: { isWon?: boolean; isLost?: boolean } | null;
}

function closedRow(row: FixtureOpportunityDueRow): boolean {
  if (row.pipelineStage?.isWon || row.pipelineStage?.isLost) return true;
  return row.stage != null && CLOSED.has(row.stage);
}

/**
 * In demo, slide an open fixture deal that still holds its seeded due date
 * forward with the rest of that set. Anything else is returned as given.
 * The input date is not changed.
 */
export function projectFixtureOpportunityDueDate<T extends Date | string | null>(
  row: FixtureOpportunityDueRow & { dueDate: T },
  now: Date,
  mode: string | undefined,
): T {
  if (mode !== 'demo' || row.dueDate == null || closedRow(row)) return row.dueDate;
  const seeded = FIXTURE_OPEN_DUE_DATES[row.code];
  if (!seeded) return row.dueDate;
  const stored = utcDayMs(row.dueDate);
  const seededMs = utcDayMs(seeded);
  if (stored == null || seededMs == null || stored !== seededMs) return row.dueDate;
  const shift = fixtureOpenShiftDays(now);
  if (shift === 0) return row.dueDate;
  const next = dayString(seededMs + shift * DAY_MS);
  return (typeof row.dueDate === 'string' ? next : new Date(`${next}T00:00:00.000Z`)) as T;
}

export interface FixtureDueMatch {
  code: string;
  storedDate: string;
  projectedDate: string;
}

/**
 * Open fixture rows the live date window would miss, whose projected due
 * date falls in [from, to). Empty unless the mode is exactly demo.
 */
export function fixtureOpenDueInWindow(
  from: Date | string,
  to: Date | string,
  now: Date,
  mode: string | undefined,
): FixtureDueMatch[] {
  if (mode !== 'demo') return [];
  const fromMs = utcDayMs(from);
  const toMs = utcDayMs(to);
  if (fromMs == null || toMs == null) return [];
  const shift = fixtureOpenShiftDays(now);
  const out: FixtureDueMatch[] = [];
  for (const [code, storedDate] of Object.entries(FIXTURE_OPEN_DUE_DATES)) {
    const storedMs = utcDayMs(storedDate);
    if (storedMs == null) continue;
    const projectedMs = storedMs + shift * DAY_MS;
    const projectedIn = projectedMs >= fromMs && projectedMs < toMs;
    const storedIn = storedMs >= fromMs && storedMs < toMs;
    if (projectedIn && !storedIn) {
      out.push({ code, storedDate, projectedDate: dayString(projectedMs) });
    }
  }
  return out;
}

/**
 * Open fixture rows whose stored due date is already past and whose
 * projected date is today or later. The overdue filter must skip these.
 */
export function fixtureOpenNotOverdue(now: Date, mode: string | undefined): FixtureDueMatch[] {
  if (mode !== 'demo') return [];
  const today = utcDayMs(now);
  if (today == null) return [];
  const shift = fixtureOpenShiftDays(now);
  const out: FixtureDueMatch[] = [];
  for (const [code, storedDate] of Object.entries(FIXTURE_OPEN_DUE_DATES)) {
    const storedMs = utcDayMs(storedDate);
    if (storedMs == null) continue;
    const projectedMs = storedMs + shift * DAY_MS;
    if (storedMs < today && projectedMs >= today) {
      out.push({ code, storedDate, projectedDate: dayString(projectedMs) });
    }
  }
  return out;
}
