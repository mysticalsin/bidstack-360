import { describe, expect, it } from 'vitest';

import { sumOpenPipelineMicros } from './open-pipeline-micros.js';

describe('sumOpenPipelineMicros', () => {
  it('keeps the open pipeline total on the cent past 2^53', () => {
    // WHY: Number(valueMicros) collapses this deal and a two-micro larger one
    // into the same integer, so the key-number total moved off the cent.
    const deal = 8598204328457184962n;
    const extra = 2n;
    expect(Number(deal) === Number(deal + extra)).toBe(true);

    const total = sumOpenPipelineMicros([
      { valueMicros: deal },
      { valueMicros: extra },
      { valueMicros: 0n },
      { valueMicros: null },
    ]);

    expect(total).toBe(deal + extra);
    expect(total.toString()).toBe('8598204328457184964');
    expect(BigInt(Math.trunc(Number(deal) + Number(extra)))).not.toBe(total);
  });
});
