import { describe, expect, it } from 'vitest';
import { Company } from './company';

describe('Company schema', () => {
  it('accepts a valid company', () => {
    const result = Company.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      orgId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
      name: 'Mantu',
      legalName: null,
      domain: 'mantu.com',
      industry: 'Consulting',
      employeeCount: 1000,
      countryCode: 'FR',
      address: null,
      billingEmail: null,
      taxId: null,
      logoUrl: null,
      website: 'https://mantu.com',
      source: 'external_crm',
      confidence: 0.95,
      enrichedAt: null,
      tier: 'key',
      parentId: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required name', () => {
    const result = Company.safeParse({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid logo url', () => {
    const result = Company.safeParse({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      orgId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
      name: 'Mantu',
      legalName: null,
      domain: null,
      industry: null,
      employeeCount: null,
      countryCode: null,
      address: null,
      billingEmail: null,
      taxId: null,
      logoUrl: 'not-a-url',
      website: null,
      source: 'external_crm',
      confidence: 0,
      enrichedAt: null,
      tier: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});
