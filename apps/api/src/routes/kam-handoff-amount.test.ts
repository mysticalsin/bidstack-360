import { describe, expect, it } from 'vitest';

import { kamHandoffOpportunityAmount } from './kam-handoff-amount.js';

const UNITS_61520_MICROS = 61_520_000_000n;

describe('KAM handoff amount under demo data', () => {
  it('does not price a synthetic bid of 61520 as euros', () => {
    // WHY: the handoff payload stamps opportunity valueMicros as EUR. The
    // column does not store a currency. Demo synthetic data of 61520 units
    // must not leave this export as a euro baseline. The micros stay on the
    // payload and the currency is not EUR.
    const amount = kamHandoffOpportunityAmount(UNITS_61520_MICROS);

    expect(amount.currency ?? '').not.toMatch(/EUR|€/);
    expect(String(amount.valueMicros)).toContain('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a value that is not an integer micros amount is not a price.
    // It must not fall through to an EUR zero.
    const missing = kamHandoffOpportunityAmount(Number.NaN);
    const fraction = kamHandoffOpportunityAmount(1.5);

    expect(missing.currency).toBeNull();
    expect(fraction.currency).toBeNull();
    expect(missing.valueMicros).not.toBe(0);
    expect(fraction.valueMicros).not.toBe(0);
    expect(missing.currency ?? '').not.toMatch(/EUR|€/);
  });
});
