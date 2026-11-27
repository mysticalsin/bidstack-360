import { describe, expect, it } from 'vitest';

import { formatKpiValue } from '@/components/charts/kpi-value';
import { describeSparkline } from '@/components/charts/sparkline-geometry';
import { fmtCompact } from '@/components/viz/viz-data';
import { fmtMoneyMicros } from '@/lib/msa/labels';

import { compactKeepsUnits } from './compact-units';

describe('shared units-kept helper', () => {
  it('answers each copied case once', () => {
    // WHY: #62, #65, and #66 each kept a private copy of this check.
    // 2,010,000 is the amount the strict copies dropped, and 12,015,000 is the
    // amount those screens rendered three different ways.
    expect(compactKeepsUnits(7_860_000)).toBe(true);
    expect(compactKeepsUnits(2_000_000)).toBe(true);
    expect(compactKeepsUnits(1_500_000)).toBe(true);
    expect(compactKeepsUnits(2_010_000)).toBe(true);
    expect(compactKeepsUnits(-7_860_000)).toBe(true);
    expect(compactKeepsUnits(12_015_000)).toBe(false);
    expect(compactKeepsUnits(-12_015_000)).toBe(false);
  });

  it('keeps 2,010,000 on every surface that copied the check', () => {
    // WHY: a strict === copy treats this two-digit million as inexact and
    // prints 2m, the full figure, or £2,010,000.00. Half a unit of binary
    // rounding still names 2.01 million.
    expect(fmtCompact(2_010_000)).toMatch(/2\.01/);
    expect(formatKpiValue(2_010_000)).toMatch(/2\.01/);
    expect(describeSparkline([2_010_000])).toMatch(/2\.01/);
    expect(fmtMoneyMicros(2_010_000_000_000, 'EUR')).toMatch(/2\.01/);
  });

  it('records the three labels for 12,015,000 from the one check', () => {
    // WHY: the shared check says two digits would move 12,015,000. The chart
    // then uses one digit, and the KPI, sparkline, and cap print the figure.
    expect(compactKeepsUnits(12_015_000)).toBe(false);
    expect(fmtCompact(12_015_000)).toBe('12m');
    expect(formatKpiValue(12_015_000)).toBe('12,015,000');
    expect(describeSparkline([12_015_000])).toContain('12,015,000');
    expect(fmtMoneyMicros(12_015_000_000_000, 'EUR')).toContain('12,015,000');
  });
});
