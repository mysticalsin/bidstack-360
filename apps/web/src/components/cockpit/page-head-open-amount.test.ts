import { describe, expect, it } from 'vitest';

import { pageHeadOpenAmount } from './page-head-open-amount';

describe('cockpit open pipeline under demo data', () => {
  it('does not price an open pipeline of 61520 as euros', () => {
    // WHY: the account header sums open opportunity value and prints that
    // number as euros. Those rows do not store a currency. Demo synthetic
    // data sent 61520 units through an EUR formatter, so Open pipeline read
    // as a euro forecast. The figure stays 61520 and does not name EUR.
    const label = pageHeadOpenAmount(61520);
    expect(label).not.toMatch(/EUR|€/);
    expect(label.replace(/\D/g, '')).toBe('61520');
  });

  it('does not invent a euro zero when the open pipeline is not a finite number', () => {
    // WHY: an open pipeline that is not a finite number is not a price. It
    // must not fall through to an EUR zero.
    expect(pageHeadOpenAmount(Number.NaN)).toBe('Not a number');
    expect(pageHeadOpenAmount(Number.POSITIVE_INFINITY)).toBe('Not a number');
    expect(pageHeadOpenAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
