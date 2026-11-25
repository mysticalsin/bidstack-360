// The Industries card sits beside Countries. Countries counts distinct codes.
// Industries counted every row that had an industry, so the demo book looked
// like one industry per company. CI Financial and DNB Bank are both
// financial_services. A blank industry is not an industry. This fails if the
// card goes back to counting classified profiles.
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCompanies } from '@/hooks/useCompanies';

import { CompaniesPage } from './CompaniesPage';

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: vi.fn(),
  useCreateCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasAdminPermission: vi.fn(() => false),
  useHasPermission: vi.fn(() => true),
}));

function company(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    orgId: '22222222-2222-2222-2222-222222222222',
    name: 'Acme Corp',
    legalName: null,
    domain: 'acme.example',
    industry: 'financial_services',
    employeeCount: 500,
    countryCode: 'CA',
    address: null,
    billingEmail: null,
    taxId: null,
    logoUrl: null,
    website: null,
    source: 'manual',
    confidence: 1,
    enrichedAt: null,
    tier: null,
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function statValue(label: string): string {
  const summary = screen.getByRole('region', { name: 'Company list summary' });
  const caption = within(summary).getByText(label);
  const value = caption.parentElement?.querySelector('strong')?.textContent;
  return value ?? '';
}

describe('Companies list industry count', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('counts CI Financial and DNB Bank as one industry, not two classified profiles', () => {
    vi.mocked(useCompanies).mockReturnValue({
      data: {
        items: [
          company({
            id: 'c0000000-0000-4000-8000-000000000001',
            name: 'CI Financial',
            industry: 'financial_services',
            countryCode: 'CA',
          }),
          company({
            id: 'c0000000-0000-4000-8000-000000000008',
            name: 'DNB Bank',
            industry: 'financial_services',
            countryCode: 'NO',
          }),
          company({
            id: 'c0000000-0000-4000-8000-0000000000aa',
            name: 'Unclassified Co',
            industry: '   ',
            countryCode: null,
          }),
        ],
        nextCursor: undefined,
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useCompanies>);

    renderPage();

    expect(statValue('Visible companies')).toBe('3');
    expect(statValue('Countries')).toBe('2');
    expect(statValue('Industries')).toBe('1');

    const summary = screen.getByRole('region', { name: 'Company list summary' });
    const industries = within(summary).getByText('Industries').parentElement;
    expect(industries?.textContent).toContain('on this page');
    expect(industries?.textContent).not.toContain('classified profiles');
  });
});
