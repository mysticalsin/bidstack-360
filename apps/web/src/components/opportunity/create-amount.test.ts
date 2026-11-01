import { describe, expect, it } from 'vitest';

import { createAmountPayload } from './create-amount';

describe('createAmountPayload', () => {
  it('keeps a small amount as both the unit number and the micros', () => {
    expect(createAmountPayload('2.5')).toEqual({ value: 2.5, valueMicros: '2500000' });
  });

  it('sends a large amount as micros so the unit number cannot round it', () => {
    // WHY: Number("8598204328457.184962") * 1e6 is not the stored remainder.
    const payload = createAmountPayload('8598204328457.184962');
    expect(payload?.valueMicros).toBe('8598204328457184962');
    expect(payload?.value).toBe(0);
  });

  it('rejects text that is not an amount', () => {
    expect(createAmountPayload('nope')).toBeNull();
  });
});
