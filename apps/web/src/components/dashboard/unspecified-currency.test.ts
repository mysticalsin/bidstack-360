import { describe, expect, it } from 'vitest';

import { compareMicros, formatExactUnspecified, microsSharePercent } from './unspecified-currency';

describe('exact unspecified amounts', () => {
  it('prints a large micros string on the exact cent', () => {
    // WHY: compact formatting and Number(bigint) / 1e6 both moved this amount
    // off the cent. The map tooltip has to show the integer total.
    expect(formatExactUnspecified('8598204328457184962')).toBe(
      '8,598,204,328,457.18 unspecified',
    );
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
});
