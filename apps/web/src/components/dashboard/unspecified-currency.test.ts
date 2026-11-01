import { describe, expect, it } from 'vitest';

import {
  compareMicros,
  formatExactUnspecified,
  formatRecordedDealAmount,
  formatUnspecifiedCompactMicros,
  headlineMicrosLabel,
  recordedMicros,
  sumRecordedDealMicros,
  sumRecordedDealUnits,
  microsSharePercent,
  shareBarWidth,
} from './unspecified-currency';

describe('exact unspecified amounts', () => {
  it('prints a large micros string on the exact cent', () => {
    // WHY: compact formatting and Number(bigint) / 1e6 both moved this amount
    // off the cent. The map tooltip has to show the integer total.
    expect(formatExactUnspecified('8598204328457184962')).toBe('8,598,204,328,457.18 unspecified');
    expect(formatExactUnspecified('8598204328457184962')).not.toContain('457.19');
  });

  it('sizes a bar from integer micros when float would call the two amounts equal', () => {
    const smaller = '9007199254740992';
    const larger = '9007199254740993';
    expect(Number(smaller) === Number(larger)).toBe(true);
    expect(compareMicros(smaller, larger)).toBe(-1);
    expect(microsSharePercent(smaller, larger)).toBeLessThan(100);
    expect(microsSharePercent(larger, larger)).toBe(100);
  });

  it('prints the full integer when compact rounding moves the amount', () => {
    // WHY: 12,015,000 was shown as 12.02M, five thousand higher.
    expect(headlineMicrosLabel('12015000000000')).toBe('12,015,000');
    expect(headlineMicrosLabel('12015000000000')).not.toBe('12.02M');
    expect(headlineMicrosLabel('7860000000000')).toBe('7.86M');
    expect(headlineMicrosLabel('200000500000')).toBe('200,000.50');
    // WHY: Japanese counts by 10,000, so 1201.5万 is this amount. Hindi 1.2 करोड़ is not.
    expect(headlineMicrosLabel('12015000000000', 'ja')).toBe('1201.5万');
    expect(headlineMicrosLabel('12015000000000', 'hi')).toBe('12,015,000');
    expect(headlineMicrosLabel('7860000000000', 'hi')).toContain('78.6');
    // WHY: Eastern Arabic digits were stripped, so an exact ٧٫٨٦ مليون became the full integer.
    const ar = new Intl.NumberFormat('ar-EG', {
      notation: 'compact',
      maximumFractionDigits: 2,
    });
    expect(headlineMicrosLabel('7860000000000', 'ar-EG')).toBe(ar.format(7_860_000));
    expect(headlineMicrosLabel('12015000000000', 'ar-EG')).toBe('12,015,000');
    const bn = new Intl.NumberFormat('bn', { notation: 'compact', maximumFractionDigits: 2 });
    expect(headlineMicrosLabel('7860000000000', 'bn')).toBe(bn.format(7_860_000));
    expect(headlineMicrosLabel('12015000000000', 'bn')).toBe('12,015,000');
  });

  it('prints a deal from micros when the unit number is zero', () => {
    // WHY: a large deal is stored with value 0, so the closing row showed 0.
    expect(formatRecordedDealAmount({ value: 0, valueMicros: '8598204328457184962' })).toBe(
      '8,598,204,328,457.18',
    );
    expect(formatRecordedDealAmount({ value: 500_000 })).toBe('500,000');
    expect(formatRecordedDealAmount({ value: 0, valueMicros: '1500000000000' }, 'compact')).toBe(
      '1.5M unspecified',
    );
    const huge = (9007199254740993n * 1_000_000n).toString();
    expect(formatRecordedDealAmount({ value: 0, valueMicros: huge }, 'compact')).toBe(
      '9,007,199,254,740,993 unspecified',
    );
    expect(formatRecordedDealAmount({ value: 0, valueMicros: huge }, 'compact')).not.toContain(
      '9,007,199,254,740,992',
    );
  });

  it('sums a stage from micros when one card has a zero unit number', () => {
    // WHY: the kanban column added value, so this card did not change the total.
    expect(sumRecordedDealUnits([{ value: 10_000 }, { value: 40_000 }])).toBe(50_000);
    const huge = (9007199254740993n * 1_000_000n).toString();
    expect(
      sumRecordedDealMicros([
        { value: 0, valueMicros: huge },
        { value: 0, valueMicros: huge },
      ]),
    ).toBe(9007199254740993n * 2_000_000n);
    expect(
      sumRecordedDealUnits([{ value: 0, valueMicros: '8598204328457184962' }]).toFixed(2),
    ).toBe('8598204328457.18');
  });

  it('keeps two account totals apart when their unit numbers collapse', () => {
    // WHY: key and top lists used to add the unit number. Past the safe integer
    // those two amounts become one number, so the shorter bar read as full.
    const smaller = (9007199254740992n * 1_000_000n).toString();
    const larger = (9007199254740993n * 1_000_000n).toString();
    const collapsed = Number(9007199254740993n);
    expect(collapsed).toBe(9007199254740992);
    expect(recordedMicros(collapsed, smaller).toString()).toBe(smaller);
    expect(recordedMicros(collapsed, larger).toString()).toBe(larger);
    expect(
      microsSharePercent(recordedMicros(collapsed, smaller), recordedMicros(collapsed, larger)),
    ).toBeLessThan(100);
    const summed = recordedMicros(collapsed, smaller) + recordedMicros(collapsed, larger);
    expect(summed).toBe((9007199254740992n + 9007199254740993n) * 1_000_000n);
    expect(formatUnspecifiedCompactMicros(summed)).toContain('unspecified');
    expect(recordedMicros(collapsed)).toBe(0n);
  });

  it('draws no bar for a zero share and keeps a floor for a thin positive share', () => {
    // WHY: a minimum width on a zero segment made an empty industry look occupied.
    expect(shareBarWidth(0, 2)).toBe(0);
    expect(shareBarWidth(-1, 3)).toBe(0);
    expect(shareBarWidth(0.4, 2)).toBe(2);
    expect(shareBarWidth(100, 3)).toBe(100);
  });
});
