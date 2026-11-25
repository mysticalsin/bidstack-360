/**
 * Manual-override tiles sum amounts a rep saved. The demo book has none.
 * A settled empty book must not print those tiles as zero. An unsettled
 * read is not an empty book, so the tiles stay until the list resolves.
 */
export function manualForecastTotalsVisible(input: {
  settled: boolean;
  loadedCount: number;
}): boolean {
  if (!input.settled) return true;
  return input.loadedCount > 0;
}

export const MANUAL_TOTALS_EMPTY =
  'No manual amounts yet. The projection above is the forecast.';
