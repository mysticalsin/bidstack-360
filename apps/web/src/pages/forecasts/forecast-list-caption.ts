/** Forecast rows the manual list draws. The route reads one past this page. */
export const FORECAST_LIST_PAGE = 500;

/**
 * Caption on the forecast group table. The route reads one forecast past this
 * page and drops it. A continued page is not every forecast. A shorter page
 * keeps "N forecast groups". No forecast total is invented.
 */
export function forecastGroupCaption(
  count: number,
  pageContinues: boolean,
  latest: number,
): string {
  if (pageContinues) {
    return `${count} forecast groups in the latest ${latest}, not every forecast`;
  }
  return `${count} forecast groups`;
}

/**
 * Note above the manual-override amounts. Those sums are the loaded page.
 * A continued page is not every forecast. A shorter page keeps the old totals
 * label. No forecast total is invented.
 */
export function forecastTotalsNote(pageContinues: boolean): string | null {
  if (!pageContinues) return null;
  return 'These amounts are the loaded forecasts for this period filter, not every forecast.';
}

/**
 * The period filter only changes the list once a forecast is loaded.
 * While the read is unsettled, or the book has none, every shape is the
 * same screen — Monthly, Quarterly, and Yearly included.
 */
export function showForecastPeriodFilter(loadedCount: number, settled: boolean): boolean {
  return settled && loadedCount > 0;
}
