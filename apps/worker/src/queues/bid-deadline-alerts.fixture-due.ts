// Demo-only read clock for the bid-deadline alert scan.
// Open fixture bids store absolute due dates (2026-06-30 through 2026-09-30).
// The scan compares those stored dates with today. On a later clock every one
// of them is more than 30 days past, so the query never returns them and the
// owner gets no 7/3/1 alert. This slides a still-seeded open row so the
// earliest of that set is tomorrow. The gaps stay. The stored row is not
// written. Real mode, and any mode other than exact `demo`, is unchanged.

const DAY_MS = 86_400_000;

/**
 * Open fixture bids and the absolute due dates `fixtureOpps` writes.
 * A closed seed deal is not here: that date is history.
 */
export const FIXTURE_BID_ALERT_DUE_DATES: Readonly<Record<string, string>> = {
  'OP-2041': '2026-07-22',
  'OP-2042': '2026-08-15',
  'OP-2043': '2026-06-30',
  'OP-2044': '2026-09-30',
  'OP-2045': '2026-08-01',
  'OP-2048': '2026-09-15',
};

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

/** Days to add so the earliest seeded open bid lands on tomorrow. Zero while that date is still today or later. */
function fixtureBidAlertShiftDays(now: Date): number {
  const earliest = Object.values(FIXTURE_BID_ALERT_DUE_DATES).reduce((min, day) =>
    day < min ? day : min,
  );
  const earliestMs = utcDayMs(earliest);
  const today = utcDayMs(now);
  if (earliestMs == null || today == null || earliestMs >= today) return 0;
  return Math.round((today + DAY_MS - earliestMs) / DAY_MS);
}

export interface FixtureBidAlertDueRow {
  code: string;
  stage?: string | null;
  dueDate: Date;
  pipelineStage?: { isWon?: boolean; isLost?: boolean } | null;
}

function closedRow(row: FixtureBidAlertDueRow): boolean {
  if (row.pipelineStage?.isWon || row.pipelineStage?.isLost) return true;
  return row.stage != null && CLOSED.has(row.stage);
}

/**
 * In demo, slide an open fixture bid that still holds its seeded due date
 * forward with the rest of that set. Anything else is the same Date.
 * The input date is not changed.
 */
export function projectFixtureBidAlertDue(
  row: FixtureBidAlertDueRow,
  now: Date,
  mode: string | undefined,
): Date {
  if (mode !== 'demo' || closedRow(row)) return row.dueDate;
  const seeded = FIXTURE_BID_ALERT_DUE_DATES[row.code];
  if (!seeded) return row.dueDate;
  const stored = utcDayMs(row.dueDate);
  const seededMs = utcDayMs(seeded);
  if (stored == null || seededMs == null || stored !== seededMs) return row.dueDate;
  const shift = fixtureBidAlertShiftDays(now);
  if (shift === 0) return row.dueDate;
  return new Date(seededMs + shift * DAY_MS);
}

export interface FixtureBidAlertMatch {
  code: string;
  dueDate: Date;
}

function fixtureBidsByWindow(
  now: Date,
  mode: string | undefined,
  windowStart: Date,
  windowEnd: Date,
  keep: 'missing' | 'outside',
): FixtureBidAlertMatch[] {
  if (mode !== 'demo' || fixtureBidAlertShiftDays(now) === 0) return [];
  const start = utcDayMs(windowStart);
  const end = utcDayMs(windowEnd);
  if (start == null || end == null) return [];
  const shift = fixtureBidAlertShiftDays(now);
  const out: FixtureBidAlertMatch[] = [];
  for (const [code, stored] of Object.entries(FIXTURE_BID_ALERT_DUE_DATES)) {
    const storedMs = utcDayMs(stored);
    if (storedMs == null) continue;
    const projectedMs = storedMs + shift * DAY_MS;
    const storedIn = storedMs >= start && storedMs <= end;
    const projectedIn = projectedMs >= start && projectedMs <= end;
    const selected = keep === 'missing' ? projectedIn && !storedIn : storedIn && !projectedIn;
    if (selected) out.push({ code, dueDate: new Date(storedMs) });
  }
  return out;
}

/**
 * Fixture rows the stored-date window misses whose projected due date falls
 * inside it. The query ORs these in. Real mode, and a demo whose seeded
 * dates are still ahead, returns none.
 */
export function fixtureBidsMissingFromAlertWindow(
  now: Date,
  mode: string | undefined,
  windowStart: Date,
  windowEnd: Date,
): FixtureBidAlertMatch[] {
  return fixtureBidsByWindow(now, mode, windowStart, windowEnd, 'missing');
}

/**
 * Fixture rows the stored-date window would return whose projected due date
 * is outside it. The query leaves them out so they do not occupy the front
 * of the batch. Real mode, and a demo whose seeded dates are still ahead,
 * returns none.
 */
export function fixtureBidsOutsideAlertWindow(
  now: Date,
  mode: string | undefined,
  windowStart: Date,
  windowEnd: Date,
): FixtureBidAlertMatch[] {
  return fixtureBidsByWindow(now, mode, windowStart, windowEnd, 'outside');
}
