import { describe, expect, it } from 'vitest';

import { leverageCardModel } from './leverageCardCopy';

// WHY: The accounts list is where the HEMA tile lands, and where Northwind
// Pharma sits in the demo book. The leverage read already knows the MSA is in
// place and that the scope does not cover IT. A card that only says "At risk"
// and "link an opportunity" hides that fact, so the next click is a guess.
// These cases fail if the list drops the headline, treats an amendment as
// permission to use the MSA as-is, or invents a reason for an account with no flag.

const headline = 'MSA in place via HEMA, no IT business yet: use the existing MSA to enter IT';

describe('leverage card copy', () => {
  it('names the amendment when the scope does not already allow other lines', () => {
    expect(
      leverageCardModel([
        { headline, scopeNeedsAmendment: true, scopeAllowsOtherServices: false },
      ]),
    ).toEqual({
      headline,
      scope: 'amendment',
      extraCount: 0,
    });
  });

  it('names an open scope when other lines are already allowed', () => {
    expect(
      leverageCardModel([
        {
          headline: 'MSA in place via HEMA, no digital business yet',
          scopeNeedsAmendment: false,
          scopeAllowsOtherServices: true,
        },
      ]),
    ).toEqual({
      headline: 'MSA in place via HEMA, no digital business yet',
      scope: 'allowed',
      extraCount: 0,
    });
  });

  it('says the scope is unstated when neither amendment nor permission is known', () => {
    expect(
      leverageCardModel([
        { headline: 'MSA in place', scopeNeedsAmendment: false, scopeAllowsOtherServices: null },
      ]),
    ).toEqual({
      headline: 'MSA in place',
      scope: 'unstated',
      extraCount: 0,
    });
  });

  it('keeps a second agreement as a count instead of dropping it', () => {
    expect(
      leverageCardModel([
        { headline, scopeNeedsAmendment: true, scopeAllowsOtherServices: false },
        { headline: 'Another MSA', scopeNeedsAmendment: false, scopeAllowsOtherServices: true },
      ]),
    ).toEqual({ headline, scope: 'amendment', extraCount: 1 });
  });

  it('says nothing when the account has no leverage flag', () => {
    expect(leverageCardModel([])).toBeNull();
  });

  it('prefers the amendment fact when both signals are set', () => {
    expect(
      leverageCardModel([
        { headline, scopeNeedsAmendment: true, scopeAllowsOtherServices: true },
      ])?.scope,
    ).toBe('amendment');
  });
});
