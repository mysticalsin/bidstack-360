import { describe, expect, it } from 'vitest';

import { referenceSearchValue } from './reference-search-amount.js';

const UNITS_61520_MICROS = 61_520_000_000n;

describe('reference search amount under demo data', () => {
  it('does not price a reference of 61520 as euros', () => {
    // WHY: reference value_micros has no currency column. Search published
    // that integer as valueEur, so a demo reference of 61520 units read as a
    // euro deal. The figure stays 61520 and the row does not name EUR.
    const row = referenceSearchValue(UNITS_61520_MICROS);
    expect(row).toEqual({ valueUnits: 61520 });
    expect(row).not.toHaveProperty('valueEur');
    expect(JSON.stringify(row)).not.toMatch(/EUR|€/);
    expect(referenceSearchValue(61_520_500_000n)).toEqual({ valueUnits: 61520.5 });
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a micros value that is not a safe integer is not a price. It must
    // not fall through to an EUR zero.
    expect(referenceSearchValue(Number.NaN)).toEqual({ valueUnits: null });
    expect(referenceSearchValue(1.5)).toEqual({ valueUnits: null });
    expect(referenceSearchValue(BigInt(Number.MAX_SAFE_INTEGER) + 2n)).toEqual({
      valueUnits: null,
    });
    expect(JSON.stringify(referenceSearchValue(Number.NaN))).not.toMatch(/EUR|€/);
  });
});
