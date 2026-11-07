import { describe, expect, it } from 'vitest';

import {
  accessScopeFromApiKey,
  applyCompanyScope,
  accountOpportunityScopePredicate,
  applyMsaResourceScope,
  applyOpportunityScope,
  companyScopePredicate,
} from './access-scope.js';

const KEY = 'apikey:11111111-1111-4111-8111-111111111111';
const COMPANY_A = '22222222-2222-4222-8222-222222222222';
const MSA_A = '33333333-3333-4333-8333-333333333333';

describe('API key resource scope (B2)', () => {
  it('default-denies a new key with no company or MSA ids', () => {
    // WHY: unscoped new keys must not inherit org-wide company/MSA access.
    const scope = accessScopeFromApiKey(KEY, {
      unrestrictedScope: false,
      companyIds: [],
      msaIds: [],
    });
    expect(scope.unrestricted).toBe(false);
    expect(companyScopePredicate(scope)).toEqual({ id: { in: [] } });
    expect(applyMsaResourceScope({ orgId: 'org-1', deletedAt: null }, scope)).toEqual({
      AND: [{ orgId: 'org-1', deletedAt: null }, { id: { in: [] } }],
    });
  });

  it('keeps grandfathered keys unrestricted', () => {
    const scope = accessScopeFromApiKey(KEY, {
      unrestrictedScope: true,
      companyIds: [],
      msaIds: [],
    });
    expect(scope.unrestricted).toBe(true);
    expect(companyScopePredicate(scope)).toBeNull();
    expect(applyCompanyScope({ orgId: 'org-1' }, scope)).toEqual({ orgId: 'org-1' });
    expect(applyMsaResourceScope({ orgId: 'org-1' }, scope)).toEqual({ orgId: 'org-1' });
  });

  it('limits companies to the allowlist and MSAs to listed ids or companies', () => {
    const scope = accessScopeFromApiKey(KEY, {
      unrestrictedScope: false,
      companyIds: [COMPANY_A],
      msaIds: [MSA_A],
    });
    expect(applyCompanyScope({ orgId: 'org-1', deletedAt: null }, scope)).toEqual({
      AND: [{ orgId: 'org-1', deletedAt: null }, { id: { in: [COMPANY_A] } }],
    });
    expect(applyMsaResourceScope({ orgId: 'org-1', deletedAt: null }, scope)).toEqual({
      AND: [
        { orgId: 'org-1', deletedAt: null },
        { OR: [{ id: { in: [MSA_A] } }, { companyId: { in: [COMPANY_A] } }] },
      ],
    });
  });
});

describe('API key opportunity scope', () => {
  it('never matches a restricted key against the uuid owner column', () => {
    const scope = accessScopeFromApiKey(KEY, {
      unrestrictedScope: false,
      companyIds: [],
      msaIds: [],
    });
    const where = JSON.stringify(applyOpportunityScope({ orgId: 'org-1' }, scope));
    const account = JSON.stringify(accountOpportunityScopePredicate(scope));
    expect(where).not.toContain(KEY);
    expect(account).not.toContain(KEY);
  });
});
