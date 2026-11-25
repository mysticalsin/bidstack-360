import { describe, expect, it } from 'vitest';

import { accountCockpitHref } from './account-href';

describe('accountCockpitHref', () => {
  // WHY: the deals screens must open the account by id. A customer name in
  // the path is a search, and search also matches a different company.
  it('builds /accounts/<uuid> and refuses a name', () => {
    const id = 'c0000000-0000-4000-8000-0000000000bb';
    expect(accountCockpitHref(id)).toBe(`/accounts/${id}`);
    expect(accountCockpitHref('Globex')).toBeNull();
    expect(accountCockpitHref('Globex Labs')).toBeNull();
    expect(accountCockpitHref(null)).toBeNull();
    expect(accountCockpitHref(undefined)).toBeNull();
    expect(accountCockpitHref('')).toBeNull();
  });
});