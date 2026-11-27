import { describe, expect, it } from 'vitest';

import { manualForecastTotalsVisible } from './forecast-manual-totals';

describe('manualForecastTotalsVisible', () => {
  it('hides the tiles when the settled book has no manual forecast', () => {
    // WHY: demo seed writes bids and no forecast rows. Zero tiles labeled
    // Commit would answer the page with a figure nobody entered.
    expect(manualForecastTotalsVisible({ settled: true, loadedCount: 0 })).toBe(false);
  });

  it('keeps the tiles while the list has not settled', () => {
    // WHY: a load in flight is not an empty book. Hiding the tiles then
    // belongs to the loading hold, not to this empty-book check.
    expect(manualForecastTotalsVisible({ settled: false, loadedCount: 0 })).toBe(true);
  });

  it('shows the tiles once a manual amount is loaded', () => {
    // WHY: a saved commit is a real total. The empty-book rule must not
    // hide it.
    expect(manualForecastTotalsVisible({ settled: true, loadedCount: 1 })).toBe(true);
  });
});
