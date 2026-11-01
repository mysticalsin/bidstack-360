import { describe, expect, it } from 'vitest';

import { capDealSample, POSITIONING_DEAL_SAMPLE, sumMicrosAsNumber } from './micros';

describe('capDealSample', () => {
  it('keeps a short account book and does not call it a sample', () => {
    const rows = Array.from({ length: POSITIONING_DEAL_SAMPLE }, (_, index) => index);
    expect(capDealSample(rows)).toEqual({ rows, capped: false });
  });

  it('stops at 500 when one more deal exists', () => {
    // WHY: an unordered or silent take of 500 was shown as the whole open pipeline.
    const rows = Array.from({ length: POSITIONING_DEAL_SAMPLE + 1 }, (_, index) => index);
    const capped = capDealSample(rows);
    expect(capped.capped).toBe(true);
    expect(capped.rows).toHaveLength(POSITIONING_DEAL_SAMPLE);
  });
});

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
