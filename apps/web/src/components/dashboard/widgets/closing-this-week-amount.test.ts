import { describe, expect, it } from 'vitest';

import { closingThisWeekAmount } from './closing-this-week-amount';

describe('closing this week value under demo data', () => {
  it('does not price a closing-this-week row of 61520 as euros', () => {
    // WHY: closing-this-week rows print a value as euros. Those rows do
    // not store a currency. Demo synthetic data sent 61520 units through
    // an EUR formatter, so a row read as a euro forecast. The figure stays
    // 61520 and does not name EUR.
    const label = closingThisWeekAmount(61520);
    expect(label).not.toMatch(/EUR|€/);
    expect(label.replace(/\D/g, '')).toBe('61520');
  });

  it('does not invent a euro zero when the row value is not a finite number', () => {
    // WHY: a row value that is not a finite number is not a price.
    // It must not fall through to an EUR zero.
    expect(closingThisWeekAmount(Number.NaN)).toBe('Not a number');
    expect(closingThisWeekAmount(Number.POSITIVE_INFINITY)).toBe('Not a number');
    expect(closingThisWeekAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
