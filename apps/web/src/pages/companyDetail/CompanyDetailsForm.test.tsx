import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompanyDetail } from '@bidstack/shared';

// PATCH /companies/:id is admin-only (companies:write, packages/db/src/seed.rbac.ts);
// this locks in that the Save button reflects that up front instead of only
// failing after a non-admin fills out the whole form and submits.
const hookMocks = vi.hoisted(() => ({
  canWrite: true,
  mutate: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => hookMocks.canWrite,
}));

vi.mock('@/hooks/useCompanies', () => ({
  useUpdateCompany: () => ({ mutate: hookMocks.mutate, isPending: false }),
}));

import { CompanyDetailsForm } from './CompanyDetailsForm';

function baseCompany(): CompanyDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
    name: 'Acme Corp',
    legalName: null,
    domain: null,
    industry: null,
    employeeCount: null,
    countryCode: null,
    address: null,
    billingEmail: null,
    taxId: null,
    logoUrl: null,
    website: null,
    source: 'manual',
    confidence: 1,
    enrichedAt: null,
    tier: 'standard',
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    contacts: [],
    opportunities: [],
    openCases: [],
    notes: [],
    parent: null,
    children: [],
  };
}

describe('CompanyDetailsForm — companies:write gating', () => {
  afterEach(() => {
    cleanup();
    hookMocks.canWrite = true;
    hookMocks.mutate.mockClear();
  });

  it('disables Save changes and explains why for a user without companies:write', () => {
    hookMocks.canWrite = false;
    render(<CompanyDetailsForm company={baseCompany()} onDone={vi.fn()} />);

    const save = screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/don.t have permission to save changes/i)).toBeTruthy();
  });

  it('keeps Save changes enabled for a user with companies:write', () => {
    hookMocks.canWrite = true;
    render(<CompanyDetailsForm company={baseCompany()} onDone={vi.fn()} />);

    const save = screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(screen.queryByText(/don.t have permission to save changes/i)).toBeNull();
  });
});
