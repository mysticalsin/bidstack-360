import { wonByQuarter, type OppRow } from '@/components/viz/viz-data';

export interface ProjectionPeriodAmounts {
  label: string;
  openMicros: number;
  weightedMicros: number;
  wonMicros: number;
}

export interface RevenueQuarter {
  label: string;
  won: number;
  weighted: number;
  open: number;
}

const units = (micros: number) => micros / 1e6;

/**
 * Quarters for the Performance revenue chart.
 *
 * Won money follows the close date on the bid rows. The projection can still
 * place that same win on the due date, a later quarter. Copying the
 * projection's won amount then books the win twice. Weighted pipeline and
 * open pipeline still come from the projection.
 *
 * When the rows contain no closed win, the projection's won amount is the
 * only figure the chart has, so it stays.
 */
export function performanceRevenueQuarters(
  rows: OppRow[],
  periods: readonly ProjectionPeriodAmounts[] | undefined,
): RevenueQuarter[] {
  const actuals = wonByQuarter(rows).map((q) => ({
    label: q.label,
    won: q.won,
    weighted: 0,
    open: 0,
  }));
  const wonByLabel = new Map(actuals.map((q) => [q.label, q.won]));
  const rowsBookedAWin = actuals.length > 0;
  const future = (periods ?? [])
    .filter((p) => p.openMicros > 0 || p.weightedMicros > 0)
    .map((p) => ({
      label: p.label,
      won: rowsBookedAWin ? (wonByLabel.get(p.label) ?? 0) : units(p.wonMicros),
      weighted: units(p.weightedMicros),
      open: units(p.openMicros),
    }));
  const seen = new Set(future.map((f) => f.label));
  return [...actuals.filter((a) => !seen.has(a.label)), ...future];
}
