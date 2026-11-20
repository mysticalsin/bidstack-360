import { describe, expect, it } from 'vitest';

import { derived } from './account-financials.js';

describe('derived operating margin', () => {
  it('is null, not Infinity or NaN, when revenue is 0 or missing', () => {
    // WHY: every positive-revenue example still passes if this divides by zero.
    // A zero or absent revenue is not a margin.
    const zero = derived({
      revenue: { value: 0, concept: 'ifrs-full:Revenue' },
      operatingIncome: { value: 10, concept: 'ifrs-full:ProfitLossFromOperatingActivities' },
    });
    const missing = derived({
      operatingIncome: { value: 10, concept: 'ifrs-full:ProfitLossFromOperatingActivities' },
    });
    for (const margin of [zero.operatingMargin, missing.operatingMargin]) {
      expect(margin).toBeNull();
      expect(margin).not.toBe(Number.POSITIVE_INFINITY);
      expect(margin).not.toBe(Number.NEGATIVE_INFINITY);
      expect(Number.isNaN(margin)).toBe(false);
    }
    expect(derived({
      revenue: { value: 100, concept: 'ifrs-full:Revenue' },
      operatingIncome: { value: 20, concept: 'ifrs-full:ProfitLossFromOperatingActivities' },
    }).operatingMargin).toBe(20);
  });
});
