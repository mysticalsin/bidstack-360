import { describe, expect, it } from 'vitest';

import {
  accessScopeFromApiKey,
  accountOpportunityScopePredicate,
  applyCompanyScope,
  applyOpportunityScope,
  applyMsaResourceScope,
  companyScopePredicate,
} from './access-scope.js';
import { visibleMeetingWhere } from '../meeting-intel/access.js';

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

  // A restricted key's userId is "apikey:<id>", not a uuid. Putting it in an
  // ownerId clause made Prisma throw, so every opportunity read by a scoped
  // key answered 500.
  it('scopes opportunities by the company allowlist, never by an apikey ownerId', () => {
    const scoped = accessScopeFromApiKey(KEY, { unrestrictedScope: false, companyIds: [COMPANY_A], msaIds: [] });
    expect(applyOpportunityScope({ orgId: 'org-1' }, scoped)).toEqual({
      AND: [{ orgId: 'org-1' }, { companyId: { in: [COMPANY_A] } }],
    });
    expect(accountOpportunityScopePredicate(scoped)).toEqual({ companyId: { in: [COMPANY_A] } });

    const denied = accessScopeFromApiKey(KEY, { unrestrictedScope: false, companyIds: [], msaIds: [] });
    expect(JSON.stringify(applyOpportunityScope({ orgId: 'org-1' }, denied))).not.toContain('apikey:');
    expect(applyOpportunityScope({ orgId: 'org-1' }, denied)).toEqual({
      AND: [{ orgId: 'org-1' }, { companyId: { in: [] } }],
    });
  });

  it('meeting visibility for a key never compares an apikey id to a uuid column', () => {
    for (const unrestrictedScope of [true, false]) {
      const scope = accessScopeFromApiKey(KEY, { unrestrictedScope, companyIds: [COMPANY_A], msaIds: [] });
      const where = visibleMeetingWhere('org-1', scope);
      expect(JSON.stringify(where)).not.toContain('apikey:');
      expect(where).toMatchObject({ orgId: 'org-1', visibility: 'org' });
    }
  });
});
