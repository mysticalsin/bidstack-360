import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

const MICROS_PER_UNIT = 1_000_000;

export interface ForecastChartPeriod {
  period: string;
  label: string;
  openMicros: number;
  weightedMicros: number;
  wonMicros: number;
}

export interface ForecastChartColumns {
  periods: ForecastChartPeriod[];
  labels: string[];
  /** Weighted forecast, in recorded units. This is the column total. */
  weighted: number[];
  /** Closed won, in recorded units. Shown apart from the column total. */
  won: number[];
}

function recordedUnits(micros: number): number {
  if (!Number.isSafeInteger(micros)) return Number.NaN;
  return micros / MICROS_PER_UNIT;
}

/**
 * Columns for the projection chart. The stacked series is the weighted
 * forecast, so the chart total is that figure. Closed won is returned beside
 * it and must not be stacked into the total. A quarter with no open pipeline,
 * no weight, and no closed won stays off the chart.
 */
export function forecastChartColumns(periods: readonly ForecastChartPeriod[]): ForecastChartColumns {
  const kept = periods.filter((p) => p.openMicros > 0 || p.weightedMicros > 0 || p.wonMicros > 0);
  return {
    periods: [...kept],
    labels: kept.map((p) => p.label),
    weighted: kept.map((p) => recordedUnits(p.weightedMicros)),
    won: kept.map((p) => recordedUnits(p.wonMicros)),
  };
}

/** Recorded units, grouped. A bid has no currency, so this is not a euro amount. */
export function formatForecastChartAmount(units: number): string {
  if (!Number.isFinite(units)) return 'Not a number';
  return formatUnspecifiedAmount(units);
}
