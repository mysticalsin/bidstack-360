import { describe, expect, it } from 'vitest';

import { commitmentDealMatchesCompany } from './commitment-account.js';

describe('commitment deal company', () => {
  it('rejects a deal that belongs to a different company in the same org', () => {
    expect(commitmentDealMatchesCompany('company-a', 'company-b')).toBe(false);
    expect(commitmentDealMatchesCompany('company-a', null)).toBe(false);
  });

  it('accepts a deal on the commitment company', () => {
    expect(commitmentDealMatchesCompany('company-a', 'company-a')).toBe(true);
  });
});
