/**
 * forecasts-projection.helpers.ts — pure logic for the pipeline-weighted
 * forecast projection (Salesforce/Clari model). No Fastify/Prisma deps, so the
 * quarter math + weighting can be unit-tested without a database.
 */
import type { OpportunityStage } from '@bidstack/db';
import type { ForecastProjectionOwner, ForecastProjectionPeriod } from '@bidstack/shared';

/**
 * Default win-probability per opportunity stage (percent), used ONLY when a
 * stage key is absent from the org's configurable pipeline_stages table.
 * Mirrors DEFAULT_STAGES in pipeline-stages.ts — the org config is the source
 * of truth; this is the documented fallback so the projection is never blank
 * just because stages were never seeded.
 */
export const STAGE_WIN_PROBABILITY: Record<OpportunityStage, number> = {
  s1_lead: 10,
  s1_ongoing: 25,
  s2_sent: 40,
  s3_technical_iteration: 60,
  s4_negotiation: 80,
  closed_won: 100,
  closed_lost: 0,
};

const UNASSIGNED = 'Unassigned';

/** First day (UTC) of the quarter containing `date`. */
export function quarterStart(date: Date): Date {
  const month = date.getUTCMonth();
  const quarterFirstMonth = Math.floor(month / 3) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterFirstMonth, 1));
}

/** Period key for the quarter containing `date`, e.g. "2026-Q2". */
export function quarterPeriodKey(date: Date): string {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

/** Human label for a period key: "2026-Q2" → "Q2 2026". */
export function quarterLabel(period: string): string {
  const [year, q] = period.split('-');
  return `${q} ${year}`;
}

export interface ProjectionWindow {
  periods: string[]; // ordered, current quarter first
  currentPeriod: string;
  curQuarterStart: Date; // inclusive lower bound (UTC date)
  windowEndExclusive: Date; // exclusive upper bound (UTC date)
}

/**
 * The reporting window: the current quarter plus the next `forwardQuarters`.
 * Bounds are returned as UTC dates for the SQL period-bucketing CASE.
 */
export function buildProjectionWindow(now: Date, forwardQuarters: number): ProjectionWindow {
  const curQuarterStart = quarterStart(now);
  const periods: string[] = [];
  for (let i = 0; i <= forwardQuarters; i += 1) {
    const d = new Date(Date.UTC(curQuarterStart.getUTCFullYear(), curQuarterStart.getUTCMonth() + i * 3, 1));
    periods.push(quarterPeriodKey(d));
  }
  const windowEndExclusive = new Date(
    Date.UTC(curQuarterStart.getUTCFullYear(), curQuarterStart.getUTCMonth() + (forwardQuarters + 1) * 3, 1),
  );
  return { periods, currentPeriod: periods[0]!, curQuarterStart, windowEndExclusive };
}

/** Stage win-probability (0–100): org config first, documented fallback otherwise. */
export function resolveStageProbability(
  stage: OpportunityStage,
  stageProbabilities: Map<string, number>,
): number {
  return stageProbabilities.get(stage) ?? STAGE_WIN_PROBABILITY[stage] ?? 0;
}

/** Manual "commit" forecast row as read from the DB (pre-currency-filter). */
export interface ManualCommitRow {
  period: string;
  amountMicros: number | bigint;
  currency: string;
}

export interface ManualCommitAggregation {
  byPeriod: Map<string, number>;
  /** Rows excluded because their currency didn't match the reporting currency. */
  excludedCount: number;
}

/**
 * Sums manual "commit" forecast rows per period, restricted to the endpoint's
 * reporting currency. A row in a different currency can't be added to the
 * total without a conversion — summing raw micros across currencies would
 * silently misstate the number — so non-matching rows are excluded and
 * counted for the caller to log (exclusion should never be silent).
 */
export function aggregateManualCommit(
  rows: ManualCommitRow[],
  reportingCurrency: string,
): ManualCommitAggregation {
  const byPeriod = new Map<string, number>();
  let excludedCount = 0;
  for (const row of rows) {
    if (row.currency !== reportingCurrency) {
      excludedCount += 1;
      continue;
    }
    byPeriod.set(row.period, (byPeriod.get(row.period) ?? 0) + Number(row.amountMicros));
  }
  return { byPeriod, excludedCount };
}

/** Grouped opportunity row from the DB aggregate query. */
export interface ProjectionRow {
  period: string | null; // null = outside the window (skipped)
  ownerId: string | null;
  ownerName: string | null;
  stage: OpportunityStage;
  valueMicros: string; // numeric SUM serialized as string by the driver
}

interface OwnerAccumulator {
  ownerId: string | null;
  ownerName: string;
  openMicros: number;
  weightedMicros: number;
  wonMicros: number;
}

function emptyOwner(ownerId: string | null, ownerName: string): OwnerAccumulator {
  return { ownerId, ownerName, openMicros: 0, weightedMicros: 0, wonMicros: 0 };
}

function applyRow(owner: OwnerAccumulator, row: ProjectionRow, probability: number): void {
  const value = Number(row.valueMicros);
  if (row.stage === 'closed_won') {
    // Won is a date-anchored actual — never part of open/weighted pipeline.
    owner.wonMicros += value;
    return;
  }
  owner.openMicros += value;
  owner.weightedMicros += (value * probability) / 100;
}

/**
 * Folds grouped DB rows into per-period, per-owner projection buckets. Rows
 * whose period is outside the window (null) are skipped. Every requested period
 * is present (even at zero) so the period selector is stable.
 */
export function aggregateProjection(
  rows: ProjectionRow[],
  window: ProjectionWindow,
  stageProbabilities: Map<string, number>,
  manualCommitByPeriod: Map<string, number>,
): ForecastProjectionPeriod[] {
  const owners = new Map<string, Map<string, OwnerAccumulator>>();
  for (const period of window.periods) owners.set(period, new Map());

  for (const row of rows) {
    if (!row.period) continue;
    const periodOwners = owners.get(row.period);
    if (!periodOwners) continue;
    const ownerKey = row.ownerId ?? UNASSIGNED;
    let owner = periodOwners.get(ownerKey);
    if (!owner) {
      owner = emptyOwner(row.ownerId, row.ownerName ?? UNASSIGNED);
      periodOwners.set(ownerKey, owner);
    }
    applyRow(owner, row, resolveStageProbability(row.stage, stageProbabilities));
  }

  return window.periods.map((period) => buildPeriod(period, owners.get(period)!, manualCommitByPeriod));
}

function buildPeriod(
  period: string,
  periodOwners: Map<string, OwnerAccumulator>,
  manualCommitByPeriod: Map<string, number>,
): ForecastProjectionPeriod {
  const byOwner: ForecastProjectionOwner[] = [...periodOwners.values()]
    .map((o) => ({
      ownerId: o.ownerId,
      ownerName: o.ownerName,
      openMicros: Math.round(o.openMicros),
      weightedMicros: Math.round(o.weightedMicros),
      wonMicros: Math.round(o.wonMicros),
    }))
    .sort((a, b) => b.weightedMicros - a.weightedMicros);

  const manual = manualCommitByPeriod.get(period);
  return {
    period,
    label: quarterLabel(period),
    openMicros: byOwner.reduce((s, o) => s + o.openMicros, 0),
    weightedMicros: byOwner.reduce((s, o) => s + o.weightedMicros, 0),
    wonMicros: byOwner.reduce((s, o) => s + o.wonMicros, 0),
    manualCommitMicros: manual ?? null,
    byOwner,
  };
}
