import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCompanies } from '@/hooks/useCompanies';

import { CompaniesPage } from './CompaniesPage';

// Demo companies store industry as a code. CI Financial and DNB are
// financial_services. Northwind Pharma is pharmaceuticals. The Industry
// column printed that code. The opportunity page already says the words.
// The column stays optional; this turns it on so the caption can be read.
// A name that is already words stays as written. A blank industry stays blank.
vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: vi.fn(),
  useCreateCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasAdminPermission: vi.fn(() => false),
  useHasPermission: vi.fn(() => true),
}));

vi.mock('@/hooks/useCompanyIntelSummary', () => ({
  useIntelImports: vi.fn(() => ({ data: { items: [] } })),
}));

const COLUMNS_SLOT = 'polo.companies.columns.v1';

function company(over: Record<string, unknown>) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
    name: 'CI Financial',
    legalName: 'CI Financial',
    domain: 'ci.com',
    industry: 'financial_services',
    employeeCount: 2500,
    countryCode: 'CA',
    address: null,
    billingEmail: null,
    taxId: null,
    logoUrl: null,
    website: 'https://ci.com/',
    source: 'verified_data',
    confidence: 0.72,
    enrichedAt: '2026-01-01T00:00:00.000Z',
    tier: 'key',
    parentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    intel: null,
    ...over,
  };
}

function renderPage(items: Array<Record<string, unknown>>) {
  vi.mocked(useCompanies).mockReturnValue({
    data: { items, nextCursor: undefined },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useCompanies>);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CompaniesPage industry words', () => {
  beforeEach(() => {
    localStorage.setItem(COLUMNS_SLOT, '[]');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('says Financial Services and Pharmaceuticals, and keeps a written name', () => {
    renderPage([
      company({}),
      company({
        id: '11111111-1111-4111-8111-111111111112',
        name: 'Northwind Pharma',
        domain: 'northwind-pharma.example',
        industry: 'pharmaceuticals',
        countryCode: 'FR',
      }),
      company({
        id: '11111111-1111-4111-8111-111111111113',
        name: 'Already Words',
        industry: 'Financial Services',
      }),
    ]);

    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Financial Services')).toHaveLength(2);
    expect(within(table).getByText('Pharmaceuticals')).toBeTruthy();
    expect(within(table).queryByText('financial_services')).toBeNull();
    expect(within(table).queryByText('pharmaceuticals')).toBeNull();
  });

  it('does not invent an industry when the company has none', () => {
    renderPage([
      company({
        name: 'No Industry',
        industry: null,
      }),
    ]);

    const table = screen.getByRole('table');
    expect(within(table).getByText('No Industry')).toBeTruthy();
    expect(within(table).queryByText('Financial Services')).toBeNull();
    expect(within(table).queryByText('financial_services')).toBeNull();
    expect(within(table).queryByText('null')).toBeNull();
  });
});
