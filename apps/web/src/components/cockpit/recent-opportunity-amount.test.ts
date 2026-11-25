import { describe, expect, it } from 'vitest';

import { recentOpportunityAmount } from './recent-opportunity-amount';

describe('recent opportunity value under demo data', () => {
  it('does not price a recent opportunity of 61520 as euros', () => {
    // WHY: recent opportunity rows print a value as euros. Those rows do
    // not store a currency. Demo synthetic data sent 61520 units through
    // an EUR formatter, so a row read as a euro forecast. The figure stays
    // 61520 and does not name EUR.
    const label = recentOpportunityAmount(61520);
    expect(label).not.toMatch(/EUR|€/);
    expect(label.replace(/\D/g, '')).toBe('61520');
  });

  it('does not invent a euro zero when the opportunity value is not a finite number', () => {
    // WHY: an opportunity value that is not a finite number is not a price.
    // It must not fall through to an EUR zero.
    expect(recentOpportunityAmount(Number.NaN)).toBe('Not a number');
    expect(recentOpportunityAmount(Number.POSITIVE_INFINITY)).toBe('Not a number');
    expect(recentOpportunityAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
