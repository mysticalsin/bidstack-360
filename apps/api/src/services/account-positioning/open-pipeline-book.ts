// Full open-book total for the account cockpit tile. The opportunity page is
// capped, so a JS sum of that page under-reports. Postgres returns integer
// micros text. The sparkline is a chart of those same integers, scaled in
// bigint so Number() cannot flatten two different points. The percent beside
// the key number is the integer ratio, not Number(micros).
import { Prisma, type PrismaClient } from '@bidstack/db';

import { OPEN_OPPORTUNITY_SQL } from '../crm/dashboard.queries.js';

const DAY = 86_400_000;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
/** Oldest first. Index of 90 is the comparison the tile labels "vs 90 days ago". */
const HISTORY_DAYS = [150, 120, 90, 60, 30] as const;
const NINETY_DAYS = 90;

export interface OpenPipelineTile {
  /** Exact open-book sum. This is the number the tile prints. */
  valueMicros: string;
  /** Schema number. Unsafe micros stay on valueMicros; Infinity is not a value. */
  value: number;
  delta: number | null;
  series: number[];
  openCount: number;
}

interface BookRow {
  openMicros: unknown;
  openCount: unknown;
  d150: unknown;
  d120: unknown;
  d90: unknown;
  d60: unknown;
  d30: unknown;
}

function historySum(days: number, now: Date): Prisma.Sql {
  const at = new Date(now.getTime() - days * DAY);
  // A deal still open counts from its create time. A deal that has since
  // closed counts only until that close, same reconstruction the page used.
  return Prisma.sql`COALESCE((SUM(GREATEST(o.value_micros, 0)) FILTER (WHERE o.created_at <= ${at} AND (${Prisma.raw(OPEN_OPPORTUNITY_SQL)} OR COALESCE(o.closed_at, o.updated_at) > ${at})))::text, '0') AS ${Prisma.raw(`"d${days}"`)}`;
}

/**
 * Same account scope as the key-number page: this org, these company ids
 * (the account plus the direct children groupMap already resolved), not deleted.
 * No owner or territory predicate — the page load does not apply one.
 */
export function openPipelineBookQuery(
  orgId: string,
  companyIds: readonly string[],
  now: Date,
): Prisma.Sql {
  return Prisma.sql`
    SELECT
      COALESCE((SUM(GREATEST(o.value_micros, 0)) FILTER (WHERE ${Prisma.raw(OPEN_OPPORTUNITY_SQL)}))::text, '0') AS "openMicros",
      COUNT(*) FILTER (WHERE ${Prisma.raw(OPEN_OPPORTUNITY_SQL)})::int AS "openCount",
      ${Prisma.join(HISTORY_DAYS.map((days) => historySum(days, now)))}
    FROM opportunities o
    WHERE o.org_id = ${orgId}::uuid
      AND o.deleted_at IS NULL
      AND o.company_id IN (${Prisma.join(companyIds.map((id) => Prisma.sql`${id}::uuid`))})
  `;
}

/** Integer micros from a Postgres text sum. A JS number has already lost cents. */
export function microsFromDbText(value: unknown): bigint {
  if (typeof value === 'bigint') return value < 0n ? 0n : value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new Error('open pipeline sum is not integer micros text');
}

function countFromDb(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'bigint' && value >= 0n && value <= SAFE) return Number(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = BigInt(value);
    if (parsed <= SAFE) return Number(parsed);
  }
  throw new Error('open pipeline count is not an integer');
}

/**
 * Change vs the prior amount, in percent to one decimal. Same rounding as
 * Math.round(((cur - prev) / |prev|) * 1000) / 10, done with integers so the
 * inputs are the micros text and not Number(micros).
 */
export function percentChangeFromMicros(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  const absPrevious = previous < 0n ? -previous : previous;
  const numerator = (current - previous) * 1000n;
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let tenths = absolute / absPrevious;
  const remainder = absolute % absPrevious;
  const half = remainder * 2n;
  // Math.round halves toward +infinity: 0.5 up, -0.5 toward zero.
  if (half > absPrevious || (half === absPrevious && !negative)) tenths += 1n;
  if (negative) tenths = -tenths;
  if (tenths > SAFE || tenths < -SAFE) {
    const rough = Number(tenths);
    return Number.isFinite(rough) ? rough / 10 : null;
  }
  return Number(tenths) / 10;
}

/**
 * Chart points from the micros integers. Amounts that fit stay as they are.
 * Past that, the series is the distance above the smallest point, scaled in
 * bigint so a two-micro step is not flattened by Number(point).
 */
export function sparklineFromMicros(points: readonly bigint[]): number[] {
  if (points.length === 0) return [];
  let min = points[0]!;
  let max = points[0]!;
  for (const point of points) {
    if (point < min) min = point;
    if (point > max) max = point;
  }
  if (min >= 0n && max <= SAFE) return points.map((point) => Number(point));
  const span = max - min;
  if (span <= SAFE) return points.map((point) => Number(point - min));
  const scale = (span + SAFE - 1n) / SAFE;
  return points.map((point) => Number((point - min) / scale));
}

export function openPipelineTileFromSums(sums: {
  openMicros: unknown;
  openCount: unknown;
  historyMicros: readonly unknown[];
}): OpenPipelineTile {
  const now = microsFromDbText(sums.openMicros);
  const history = HISTORY_DAYS.map((_, index) => microsFromDbText(sums.historyMicros[index]));
  const ago = history[HISTORY_DAYS.indexOf(NINETY_DAYS)] ?? 0n;
  const numeric = Number(now);
  return {
    valueMicros: now.toString(),
    value: Number.isFinite(numeric) ? numeric : 0,
    delta: percentChangeFromMicros(now, ago),
    series: sparklineFromMicros([...history, now]),
    openCount: countFromDb(sums.openCount),
  };
}

const EMPTY_TILE: OpenPipelineTile = {
  valueMicros: '0',
  value: 0,
  delta: null,
  series: [0, 0, 0, 0, 0, 0],
  openCount: 0,
};

export async function fetchOpenPipelineBook(
  db: Pick<PrismaClient, '$queryRaw'>,
  orgId: string,
  companyIds: readonly string[],
  now: Date,
): Promise<OpenPipelineTile> {
  if (companyIds.length === 0) return EMPTY_TILE;
  const rows = await db.$queryRaw<BookRow[]>(openPipelineBookQuery(orgId, companyIds, now));
  const row = rows[0];
  if (!row) throw new Error('open pipeline aggregate returned no row');
  return openPipelineTileFromSums({
    openMicros: row.openMicros,
    openCount: row.openCount,
    historyMicros: [row.d150, row.d120, row.d90, row.d60, row.d30],
  });
}
