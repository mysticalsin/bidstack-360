import { describe, expect, it } from 'vitest';

import { sumMicrosAsNumber } from './micros';

describe('sumMicrosAsNumber', () => {
  it('adds open deal micros without rounding a safe total', () => {
    expect(sumMicrosAsNumber([1_240_000_000_000n, 806_000_000_000n, null])).toBe(
      1_240_000_000_000 + 806_000_000_000,
    );
  });

  it('refuses a total that does not fit in a JavaScript number', () => {
    // WHY: Number(sum) past 2^53 made two different books look the same.
    const half = 5_000_000_000_000_000n;
    expect(sumMicrosAsNumber([half, half])).toBeNull();
  });
});
