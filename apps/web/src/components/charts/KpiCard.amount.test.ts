import { describe, expect, it } from 'vitest';

import { formatKpiCountFrame, formatKpiValue } from './kpi-value';

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

  it('keeps every count-up frame in the same compact format as the final value', () => {
    // WHY: the 800ms count-up multiplies by an ease fraction. That non-integer
    // was printed as 5,063,132.1 and then snapped to 7.86m. Main stays compact
    // on every frame. Red-first.
    const value = 7_860_000;
    const final = formatKpiValue(value);
    expect(final).toBe('7.86m');
    expect(formatKpiValue(5_063_132.1)).toBe('5.1m');
    const frames = [5_063_132.1, -5_063_132.1];
    for (let step = 1; step <= 16; step += 1) {
      const progress = step / 16;
      const eased = 1 - (1 - progress) ** 3;
      frames.push(value * eased, -value * eased);
    }
    for (const frame of frames) {
      const shown = formatKpiCountFrame(frame);
      expect(shown, `frame ${frame}`).not.toMatch(/,/);
      if (Math.abs(frame) >= 1_000_000) expect(shown).toMatch(/m$/);
      else if (Math.abs(frame) >= 1_000) expect(shown).toMatch(/k$/);
    }
  });

  it('compacts a two-digit million that binary rounding makes look inexact', () => {
    // WHY: the equality at the two-digit check misses 34 of the 900 amounts
    // from 1m to 9.99m, so 2,010,000 prints as 2,010,000 instead of 2.01m.
    // Red-first.
    expect(formatKpiValue(2_010_000)).toBe('2.01m');
    let printedInFull = 0;
    for (let i = 0; i < 900; i += 1) {
      const amount = 1_000_000 + i * 10_000;
      if (formatKpiValue(amount).includes(',')) printedInFull += 1;
    }
    expect(printedInFull).toBe(0);
  });
});
