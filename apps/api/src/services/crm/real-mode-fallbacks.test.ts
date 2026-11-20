import { describe, expect, it } from 'vitest';

import { buildCompanies } from './company-enrichment.service.js';

describe('real mode does not invent a house account', () => {
  it('omits the Mantu fallback and its sample headcount when demo data is off', () => {
    // WHY: an empty org was getting a company named Mantu with 12,000
    // employees and a made-up revenue. That number is a fixture. With demo
    // data off, the company list is only the rows the operator entered.
    const companies = buildCompanies([], [], [], { houseAccount: false });
    expect(companies.map((company) => company.name)).not.toContain('Mantu');
    expect(companies.some((company) => company.employeeCount === 12_000)).toBe(false);
    expect(companies.some((company) => company.annualRevenueMicros != null)).toBe(false);
  });
});
