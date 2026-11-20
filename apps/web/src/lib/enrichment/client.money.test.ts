import { describe, expect, it } from 'vitest';

import { compactStep, fmtMoney } from './client';

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

  it('starts the M suffix at exactly one million', () => {
    // WHY: a threshold of greater-than one million still passes 1.5M and 2M.
    // 999,999.99 and 1,000,000.01 are not safe integers, so they never reach the step.
    expect(fmtMoney(999_999.99, 'USD')).toBe('USD 999,999.99');
    expect(fmtMoney(999_999.99, 'USD')).not.toContain('M');
    expect(fmtMoney(1_000_000, 'USD')).toBe('USD 1M');
    expect(fmtMoney(1_000_000.01, 'USD')).toBe('USD 1,000,000.01');
    expect(fmtMoney(1_000_000.01, 'USD')).not.toContain('M');
  });

  it('keeps 999,999 on the thousands step, not the million divisor', () => {
    // WHY: `>= 999_999` with the divisor still 1_000_000 prints the same
    // full amount as the real cut, because 999,999 is not an exact million
    // and not an exact thousand. The step itself is what that mutant changes.
    // 999,999.5 is not a safe integer, so it stays the exact grouped number.
    expect(fmtMoney(999_999, 'USD')).toBe('USD 999,999');
    expect(fmtMoney(999_999, 'USD')).not.toContain('M');
    expect(fmtMoney(999_999, 'USD')).not.toContain('k');
    expect(fmtMoney(999_999.5, 'USD')).toBe('USD 999,999.5');
    expect(fmtMoney(999_999.5, 'USD')).not.toContain('M');
    expect(fmtMoney(1_000_000, 'USD')).toBe('USD 1M');
    expect(compactStep(999_999)).toEqual([1_000, 'k']);
    expect(compactStep(999_999.5)).toEqual([1_000, 'k']);
    expect(compactStep(1_000_000)).toEqual([1_000_000, 'M']);
  });

  it('keeps the thousands cut at exactly 1,000', () => {
    // WHY: `>= 999` still prints the same full amount for 999, because that
    // compact is not exact. `> 1000` drops the exact thousand. The step is
    // what those mutants change. Mutant-red, not red-first: this head already
    // uses `>= 1_000`.
    expect(compactStep(999)).toBeNull();
    expect(compactStep(-999)).toBeNull();
    expect(compactStep(1_000)).toEqual([1_000, 'k']);
    expect(compactStep(-1_000)).toBeNull();
    expect(fmtMoney(999, 'USD')).toBe('USD 999');
    expect(fmtMoney(999, 'USD')).not.toContain('k');
    expect(fmtMoney(-999, 'USD')).toBe('-USD 999');
    expect(fmtMoney(1_000, 'USD')).toBe('USD 1k');
    expect(fmtMoney(-1_000, 'USD')).toBe('-USD 1k');
  });
});
