import { describe, expect, it } from 'vitest';

import { openDealCountLabel, opportunityBelongsToCompany } from './PageHead';

describe('account header opportunities', () => {
  it('does not treat a matching customer name as a company link', () => {
    // WHY: two companies can share a customer string. The stored company id is the link.
    expect(opportunityBelongsToCompany({ companyId: 'co-1' }, 'co-1')).toBe(true);
    expect(opportunityBelongsToCompany({ companyId: 'co-2' }, 'co-1')).toBe(false);
    expect(opportunityBelongsToCompany({ companyId: null }, 'co-1')).toBe(false);
  });

  it('says when the open-deal count is only the latest 50 bids', () => {
    // WHY: the header reads the latest page. That count is not the account total.
    expect(openDealCountLabel(2, true)).toBe('2 open deals in the latest 50 bids');
    expect(openDealCountLabel(1, false)).toBe('1 open deal');
  });
});
