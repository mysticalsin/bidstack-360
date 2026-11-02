import { describe, expect, it } from 'vitest';

import { publicRevenueMicros } from './enrichment.service.js';

describe('publicRevenueMicros', () => {
  it('stores a public revenue claim as integer micros', () => {
    // WHY: multiplying the unit number by 1e6 overflowed a JS number and the
    // claim was stored as nothing.
    expect(
      publicRevenueMicros({
        revenueAmount: 54_857_000_000,
        revenueAmountText: '+54857000000',
        revenueCurrency: 'NOK',
      }),
    ).toBe(54_857_000_000_000_000n);
  });

  it('does not invent micros when the claim has no currency', () => {
    expect(publicRevenueMicros({ revenueAmount: 100, revenueAmountText: '100' })).toBeNull();
  });
});
