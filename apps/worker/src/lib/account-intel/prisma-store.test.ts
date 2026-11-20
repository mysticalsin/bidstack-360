import { describe, expect, it } from 'vitest';

import { themeAmount } from './prisma-store.js';

describe('investment theme amounts', () => {
  it('stores filed money in integer micros', () => {
    expect(themeAmount({ area: 'capex', amount: 130, currency: 'EUR' })).toEqual({ amountMicros: 130_000_000n, headcount: null });
    // Past 2^53 micros a float multiply would already be off.
    expect(themeAmount({ area: 'acquisitions', amount: 12_345_678_901.25, currency: 'USD' })).toEqual({ amountMicros: 12_345_678_901_250_000n, headcount: null });
  });

  it('keeps headcount out of the money column', () => {
    expect(themeAmount({ area: 'headcount', amount: 9300, currency: null })).toEqual({ amountMicros: null, headcount: 9300 });
  });

  it('stores nothing for lines without an amount', () => {
    expect(themeAmount({ area: 'stated', amount: null, currency: null })).toEqual({ amountMicros: null, headcount: null });
  });
});
