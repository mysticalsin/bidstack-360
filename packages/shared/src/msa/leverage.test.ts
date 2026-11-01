import { describe, expect, it } from 'vitest';

import { evaluateLeverage } from './leverage.js';

const hemaMsa = {
  msaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  msaTitle: 'Northwind HEMA MSA',
  status: 'active',
  expiryDate: '2029-03-01T00:00:00.000Z',
  companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  companyName: 'Northwind Pharma',
  signingEntity: {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    slug: 'hema',
    name: 'HEMA',
    brandFamily: 'amaris' as const,
    businessLines: ['health_economics', 'market_access', 'pharma'],
    verificationStatus: 'verified' as const,
  },
  scopeOfServices: 'Health economics and market access. The scope does not include information technology.',
  affiliatesClause: 'Affiliates of the Client may not order services without an amendment.',
  scopeCitation: { page: 1, clause: 'Clause 3', excerpt: 'does not include information technology' },
  affiliatesCitation: { page: 1, clause: 'Clause 4', excerpt: 'Affiliates of the Client may not' },
};

describe('evaluateLeverage', () => {
  it('flags a HEMA MSA with no IT pipeline and cites a restrictive scope', () => {
    const flag = evaluateLeverage(hemaMsa, {
      opportunityLines: ['pharma'],
      projectLines: [],
      revenueLines: [],
    });
    expect(flag).not.toBeNull();
    expect(flag!.headline).toBe(
      'MSA in place via HEMA, no IT business yet: use the existing MSA to enter IT',
    );
    expect(flag!.missingLines).toEqual(['it', 'engineering', 'digital']);
    expect(flag!.scopeNeedsAmendment).toBe(true);
    expect(flag!.scopeAllowsOtherServices).toBe(false);
    expect(flag!.scopeCitation?.clause).toBe('Clause 3');
  });

  it('does not flag when the account already has IT business', () => {
    const flag = evaluateLeverage(hemaMsa, {
      opportunityLines: ['it', 'pharma'],
      projectLines: ['engineering'],
      revenueLines: ['digital'],
    });
    expect(flag).toBeNull();
  });
});
