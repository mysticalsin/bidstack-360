import { describe, expect, it } from 'vitest';

import { fmtMoney } from './signals.js';

describe('filing signal money', () => {
  it('keeps a filing amount when the compact label would move it', () => {
    // WHY: Math.round(7.86) printed 8m in the signal a seller reads.
    // Supersedes PR #75.
    expect(fmtMoney(7_860_000, 'EUR')).toBe('EUR 7,860,000');
    expect(fmtMoney(2_000_000, 'EUR')).toBe('EUR 2m');
    expect(fmtMoney(1_000, 'EUR')).toBe('EUR 1k');
    expect(fmtMoney(90_649e6, 'NOK')).toBe('NOK 90,649,000,000');
    expect(fmtMoney(-156_444e6, 'NOK')).toBe('-NOK 156,444,000,000');
    expect(fmtMoney(Number.NaN, 'EUR')).toBe('amount not readable');
  });
});
