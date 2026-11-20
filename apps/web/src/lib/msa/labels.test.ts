import { describe, expect, it } from 'vitest';

import { fmtMoneyMicros } from './labels';

describe('fmtMoneyMicros', () => {
  it('does not turn 7.86 million into 7.9 million', () => {
    // WHY: one compact digit rounded this cap up by forty thousand.
    const micros = 7_860_000_000_000;
    const label = fmtMoneyMicros(micros, 'gbp');
    expect(label).toMatch(/7\.86/);
    expect(label).not.toMatch(/7\.9/);
  });

  it('prints 12,015,000 in full when compact would move it', () => {
    const label = fmtMoneyMicros(12_015_000_000_000, 'EUR');
    expect(label).toContain('12,015,000');
    expect(label).not.toMatch(/12\.0/);
  });

  it('does not invent a currency when the code is blank', () => {
    expect(fmtMoneyMicros(1_500_000_000_000, '')).toBe('1,500,000 unspecified');
  });

  it('keeps a fractional unit instead of dropping the micros remainder', () => {
    // WHY: dividing by 1_000_000 in integer arithmetic turns 1.50 into 1.00.
    expect(fmtMoneyMicros(1_500_000, 'GBP')).toBe('£1.50');
    expect(fmtMoneyMicros(1, 'GBP')).toBe('£0.00');
    expect(fmtMoneyMicros(999_999, 'GBP')).toBe('£1.00');
    expect(fmtMoneyMicros(-1_500_000, 'GBP')).toBe('-£1.50');
    expect(fmtMoneyMicros(-1, 'GBP')).toBe('-£0.00');
    expect(fmtMoneyMicros(-999_999, 'GBP')).toBe('-£1.00');
  });
});
