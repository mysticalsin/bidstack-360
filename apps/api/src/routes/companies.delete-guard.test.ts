import { describe, expect, it } from 'vitest';

import { openDealsBlockAccountDelete, openDealsForAccountWhere } from './companies.delete-guard.js';

describe('account delete and live deals', () => {
  it('refuses the delete when an open deal still points at the account', () => {
    expect(openDealsBlockAccountDelete(1)).toBe(true);
    expect(openDealsBlockAccountDelete(0)).toBe(false);
  });

  it('counts only live deals, so a won or lost deal does not keep the account', () => {
    const where = openDealsForAccountWhere('org-1', 'company-1');
    expect(where.deletedAt).toBeNull();
    expect(where.stage.notIn).toEqual(['closed_won', 'closed_lost']);
    expect(where.companyId).toBe('company-1');
  });
});
