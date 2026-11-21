import { describe, expect, it } from 'vitest';

import { formatCompactMoney } from './investment.js';

describe('financial compact money', () => {
  it('keeps a financial amount when the compact label would move it', () => {
    // WHY: 90.649bn is not 90.6bn, and 7.86m is not 8m. Compact stays only
    // when it names the same amount. Supersedes PR #61.
    expect(formatCompactMoney(90_649e6, 'NOK')).toBe('NOK 90,649,000,000');
    expect(formatCompactMoney(-156_444e6, 'NOK')).toBe('-NOK 156,444,000,000');
    expect(formatCompactMoney(935e6, 'CAD')).toBe('CAD 935m');
    expect(formatCompactMoney(7_860_000, 'EUR')).toBe('EUR 7,860,000');
    expect(formatCompactMoney(2_000_000, 'EUR')).toBe('EUR 2m');
    expect(formatCompactMoney(1.7e9, 'EUR')).toBe('EUR 1.70bn');
  });
});
