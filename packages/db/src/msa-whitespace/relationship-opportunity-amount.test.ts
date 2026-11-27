import { describe, expect, it } from 'vitest';

import { relationshipOpportunityAmount } from './relationship-opportunity-amount.js';

const UNITS_61520_MICROS = 61_520_000_000n;

describe('relationship map opportunity amount under demo data', () => {
  it('does not price a synthetic bid of 61520 as euros', () => {
    // WHY: the relationship map stamps opportunity valueMicros as EUR. The
    // column does not store a currency. Demo synthetic data of 61520 units
    // must not leave this row as a euro baseline. The micros stay on the
    // row and the currency is not EUR.
    const amount = relationshipOpportunityAmount(UNITS_61520_MICROS);

    expect(amount.currency ?? '').not.toMatch(/EUR|€/);
    expect(String(amount.valueMicros)).toContain('61520');
  });

  it('does not invent a euro amount when the micros are not a safe integer', () => {
    // WHY: a value that is not an integer micros amount is not a price.
    // It must not fall through to an EUR figure.
    const missing = relationshipOpportunityAmount(Number.NaN);
    const fraction = relationshipOpportunityAmount(1.5);

    expect(missing.currency).toBeNull();
    expect(fraction.currency).toBeNull();
    expect(missing.valueMicros).toBeNull();
    expect(fraction.valueMicros).toBeNull();
    expect(missing.currency ?? '').not.toMatch(/EUR|€/);
  });
});
