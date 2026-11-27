import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompanyDetail } from '@bidstack/shared';

// PATCH /companies/:id stacks requirePermission('companies:write') AND
// requireRole('admin') server-side (apps/api/src/routes/companies.ts); this
// locks in that the Save button reflects that AND-gate up front instead of
// only failing after a non-admin (who may still hold the raw permission
// grant) fills out the whole form and submits. Only useHasAdminPermission is
// mocked — if the form regresses to the OR-based useHasPermission it is
// undefined under this mock and the render throws, failing the test loudly.
const hookMocks = vi.hoisted(() => ({
  canWrite: true,
  mutate: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasAdminPermission: () => hookMocks.canWrite,
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

const CI = 'c0000000-0000-4000-8000-000000000001';
const DNB = 'c0000000-0000-4000-8000-000000000008';

function named(id: string, name: string, domain: string, countryCode: string, employeeCount: number) {
  return {
    ...baseCompany(),
    id,
    name,
    domain,
    industry: 'financial_services',
    employeeCount,
    countryCode,
    tier: 'key' as const,
  };
}

describe('CompanyDetailsForm account switch', () => {
  afterEach(() => {
    cleanup();
    hookMocks.canWrite = true;
    hookMocks.mutate.mockClear();
  });

  it('replaces the open draft when the page stays on Edit details for the next demo account', () => {
    // The company route reuses this form. A cached account skips the loading
    // skeleton, so the draft must follow the record or Save writes CI
    // Financial onto DNB Bank.
    const onDone = vi.fn();
    const view = render(
      <CompanyDetailsForm
        company={named(CI, 'CI Financial', 'ci.com', 'CA', 2500)}
        onDone={onDone}
      />,
    );
    expect((screen.getByRole('textbox', { name: /company name/i }) as HTMLInputElement).value).toBe(
      'CI Financial',
    );

    view.rerender(
      <CompanyDetailsForm company={named(DNB, 'DNB Bank', 'dnb.no', 'NO', 9000)} onDone={onDone} />,
    );

    expect((screen.getByRole('textbox', { name: /company name/i }) as HTMLInputElement).value).toBe(
      'DNB Bank',
    );
    expect((screen.getByRole('textbox', { name: /^domain/i }) as HTMLInputElement).value).toBe(
      'dnb.no',
    );
    expect((screen.getByRole('textbox', { name: /employees/i }) as HTMLInputElement).value).toBe(
      '9000',
    );
    expect((screen.getByRole('textbox', { name: /country code/i }) as HTMLInputElement).value).toBe(
      'NO',
    );

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(hookMocks.mutate).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('keeps a name the person typed when the same account refreshes', () => {
    const company = named(CI, 'CI Financial', 'ci.com', 'CA', 2500);
    const view = render(<CompanyDetailsForm company={company} onDone={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: /company name/i }), {
      target: { value: 'CI Financial Group' },
    });
    view.rerender(
      <CompanyDetailsForm
        company={{ ...company, updatedAt: '2026-11-20T00:00:00.000Z' }}
        onDone={vi.fn()}
      />,
    );
    expect((screen.getByRole('textbox', { name: /company name/i }) as HTMLInputElement).value).toBe(
      'CI Financial Group',
    );
  });
});
