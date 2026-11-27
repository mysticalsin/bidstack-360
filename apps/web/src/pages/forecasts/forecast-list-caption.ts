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
 * Caption under Forecast Details.
 *
 * The sign-in demo has bids and no manual forecast rows. "0 forecast groups"
 * reads as the forecast itself. The projection above is the book. A zero
 * count is not a forecast total, so that caption is omitted. A saved row
 * keeps "N forecast groups". A continued page keeps the truncation caption.
 */
export function forecastDetailsCaption(
  count: number,
  pageContinues: boolean,
  latest: number,
): string | null {
  if (!pageContinues && count === 0) return null;
  return forecastGroupCaption(count, pageContinues, latest);
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
