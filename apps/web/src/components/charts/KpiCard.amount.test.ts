import { describe, expect, it } from 'vitest';

import { formatKpiValue } from './KpiCard';

describe('formatKpiValue', () => {
  it('does not turn 7.86 million into 7.9 million', () => {
    // WHY: one decimal on millions rounded this widget up by forty thousand.
    expect(formatKpiValue(7_860_000)).not.toMatch(/7\.9/);
    expect(formatKpiValue(7_860_000)).toMatch(/7\.86/);
  });

  it('prints 12,015,000 in full when compact would move it', () => {
    expect(formatKpiValue(12_015_000)).toBe('12,015,000');
  });

  it('keeps an exact million compact', () => {
    expect(formatKpiValue(1_500_000)).toMatch(/1\.5/);
  });

  it('keeps the sign on a negative amount', () => {
    // WHY: Math.abs on the way into the compact check would show a loss as a gain.
    expect(formatKpiValue(-7_860_000)).toBe('-7.86m');
    expect(formatKpiValue(-7_860_000)).not.toBe(formatKpiValue(7_860_000));
    expect(formatKpiValue(-12_015_000)).toBe('-12,015,000');
    expect(formatKpiValue(-1_500_000)).toBe('-1.5m');
  });
});
