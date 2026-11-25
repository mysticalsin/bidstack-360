/**
 * Which forecast period the page should open on.
 *
 * The projection lists the current quarter first. Demo bids close 45 days
 * out, so from late in a quarter that date is the next quarter. Opening on
 * the current quarter then shows a zero headline while the book is one tab
 * over. Stay on the current quarter when it has open pipeline, closed-won,
 * or a manual commit. Otherwise open the first later period that does.
 */
export interface ForecastPeriodFigures {
  period: string;
  label: string;
  openMicros: number;
  wonMicros: number;
  manualCommitMicros: number | null;
}

export function periodHasCloseFigures(period: ForecastPeriodFigures): boolean {
  return period.openMicros > 0 || period.wonMicros > 0 || (period.manualCommitMicros ?? 0) > 0;
}

export function forecastFocusPeriod<T extends ForecastPeriodFigures>(
  periods: readonly T[],
): T | undefined {
  const current = periods[0];
  if (!current) return undefined;
  if (periodHasCloseFigures(current)) return current;
  return periods.find(periodHasCloseFigures) ?? current;
}
