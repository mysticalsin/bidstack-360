import { describe, expect, it } from 'vitest';

import { formatMicrosAmount } from '../utils/money.js';
import { MsaLiabilityCap, presentLiabilityCap } from './msa.js';

describe('presentLiabilityCap', () => {
  it('keeps a cap past 2^53 as the digit string', () => {
    // WHY: Number(bigint) turned 8,598,204,328,457.18 into a figure one cent off,
    // and the agreement page then compact-formatted whatever survived.
    const exact = 8_598_204_328_457_184_962n;
    const collapsed = Number(exact);
    expect(Number.isSafeInteger(collapsed)).toBe(false);
    expect(presentLiabilityCap(collapsed, 'EUR')).toBeNull();
    const presented = presentLiabilityCap(exact, 'EUR');
    expect(presented).toEqual({ amountMicros: exact.toString(), currency: 'EUR' });
    expect(MsaLiabilityCap.parse(presented).amountMicros).toBe(exact.toString());
    expect(() => MsaLiabilityCap.parse({ amountMicros: collapsed, currency: 'EUR' })).toThrow();
    expect(formatMicrosAmount(BigInt(exact.toString()))).toBe('8,598,204,328,457.18');
  });

  it('keeps a safe cap as a number', () => {
    expect(presentLiabilityCap(7_860_000_000_000n, 'EUR')).toEqual({
      amountMicros: 7_860_000_000_000,
      currency: 'EUR',
    });
    expect(presentLiabilityCap(250_000_500_000n, 'EUR')?.amountMicros).toBe(250_000_500_000);
  });
});
