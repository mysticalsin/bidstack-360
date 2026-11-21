import { describe, expect, it } from 'vitest';

import { buildCompanies, emptyWorkspaceCompany } from './company-enrichment.service.js';

describe('buildCompanies', () => {
  it('does not invent a Mantu account when the org has none', () => {
    // WHY: an empty org used to receive a Mantu row with 12,000 employees and
    // 1e15 micros of revenue, so Accounts said "1 company" instead of the
    // first-run empty state. A real customer named Acme must be the only row.
    const companies = buildCompanies(
      [
        {
          customer: 'Acme',
          industry: 'Software',
          logoUrl: null,
          updatedAt: new Date('2026-11-21T00:00:00.000Z'),
        },
      ],
      [],
    );
    expect(companies.map((company) => company.name)).toEqual(['Acme']);
    expect(buildCompanies([], [])).toEqual([]);
  });
});

describe('emptyWorkspaceCompany', () => {
  it('carries no invented headcount or revenue', () => {
    const company = emptyWorkspaceCompany();
    expect(company.employeeCount).toBeNull();
    expect(company.annualRevenueMicros).toBeNull();
    expect(company.name).not.toBe('Mantu');
  });
});
