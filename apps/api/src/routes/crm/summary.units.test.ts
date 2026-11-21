import { describe, expect, it } from 'vitest';

import { microsToUnits } from '@bidstack/shared';

import { unitsFromMicrosSum } from './summary.js';

describe('unitsFromMicrosSum', () => {
  it('keeps a total past the safe integer instead of rounding the micros first', () => {
    // WHY: Number(bigint) / 1e6 rounds the micros before dividing. 2^53+2 micros
    // is not a safe integer, so the old summary moved the open pipeline.
    const micros = 9_007_199_254_740_993n;
    expect(unitsFromMicrosSum(micros)).toBe(microsToUnits(micros));
    expect(unitsFromMicrosSum(micros)).not.toBe(Number(micros) / 1_000_000);
  });

  it('reads a numeric string from SUM() and a credit', () => {
    expect(unitsFromMicrosSum('2500000')).toBe(2.5);
    expect(unitsFromMicrosSum(-1_500_000n)).toBe(-1.5);
    expect(unitsFromMicrosSum(null)).toBe(0);
  });
});
