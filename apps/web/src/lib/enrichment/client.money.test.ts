import { describe, expect, it } from 'vitest';

import { fmtMoney } from './client';

describe('enrichment fmtMoney', () => {
  it('does not turn 7.86 million into 7.9 million', () => {
    // WHY: one compact digit rounded this public revenue up by forty thousand.
    expect(fmtMoney(7_860_000, 'usd')).toBe('USD 7,860,000');
    expect(fmtMoney(7_860_000, 'usd')).not.toContain('7.9');
  });

  it('keeps a compact label only when it names the same amount', () => {
    expect(fmtMoney(1_500_000, 'EUR')).toBe('EUR 1.5M');
    expect(fmtMoney(2_000_000, 'EUR')).toBe('EUR 2M');
    expect(fmtMoney(12_015_000, 'EUR')).toBe('EUR 12,015,000');
    expect(fmtMoney(-1_500_000, 'GBP')).toBe('-GBP 1.5M');
  });

  it('does not invent a currency code', () => {
    expect(fmtMoney(1_500_000, '')).toBe('1.5M');
  });
});
