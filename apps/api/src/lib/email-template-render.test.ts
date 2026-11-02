import { describe, expect, it } from 'vitest';

import { formatAmountFromMicros } from './email-template-render.js';

describe('formatAmountFromMicros', () => {
  it('keeps large values and fractional cents exact', () => {
    // WHY: email tokens used Intl on Number(micros)/1e6, which rounded
    // cents off and corrupted amounts past the safe-integer cliff.
    const large = 9_007_199_254_740_993n;
    expect((Number(large) / 1_000_000).toString()).not.toBe('9007199254.740993');
    expect(formatAmountFromMicros(large, 'EUR')).toBe('EUR 9007199254.740993');
    expect(formatAmountFromMicros(1_234_567n, 'USD')).toBe('USD 1.234567');
  });

  it('renders a zero opportunity amount as empty so the token stays blank', () => {
    expect(formatAmountFromMicros(0n, 'EUR')).toBe('');
  });
});
