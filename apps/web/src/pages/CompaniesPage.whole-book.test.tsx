// The Companies status says "Showing latest 50 companies" for every unfiltered
// read. The demo book is ten companies and the response has no next page, so
// the sentence claims a window that is not there. The header already says how
// many companies are visible. This fails if a complete page still says the
// latest 50 are showing. A next cursor is a real window, and an empty book
// keeps the window sentence because that empty state is a different message.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCompanies } from '@/hooks/useCompanies';
import '@/i18n';

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

vi.mock('@/hooks/useCompanyIntelSummary', () => ({
  useIntelImports: vi.fn(() => ({ data: { items: [] } })),
}));

function company(index: number, name = `Company ${index}`) {
  return {
    id: `c0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    orgId: '22222222-2222-2222-2222-222222222222',
    name,
    legalName: name,
    domain: `company-${index}.example`,
    industry: 'financial_services',
    employeeCount: 100,
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
    intel: null,
  };
}

function mockList(count: number, nextCursor?: string, names?: string[]) {
  vi.mocked(useCompanies).mockReturnValue({
    data: {
      items: Array.from({ length: count }, (_, i) => company(i + 1, names?.[i])),
      nextCursor,
    },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useCompanies>);
}

function renderPage(path = '/companies') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <CompaniesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Companies list whole book', () => {
  it('does not call the demo book the latest 50 when the page is the whole read', () => {
    mockList(10, undefined, ['CI Financial', 'DNB Bank']);
    renderPage();

    expect(screen.getByText('CI Financial')).toBeTruthy();
    expect(screen.getByText('10 companies visible.')).toBeTruthy();
    expect(screen.getByText('Showing 10 companies')).toBeTruthy();
    expect(screen.queryByText('Showing latest 50 companies')).toBeNull();
  });

  it('uses the singular when the whole book is one company', () => {
    mockList(1, undefined, ['Northwind Pharma']);
    renderPage();

    expect(screen.getByText('Showing 1 company')).toBeTruthy();
    expect(screen.queryByText('Showing latest 50 companies')).toBeNull();
  });

  it('leaves a saved view on the latest-50 sentence', () => {
    // Naming the view is a separate change. This page only corrects the
    // unfiltered book, so a view still uses the window sentence.
    mockList(2);
    renderPage('/companies?view=revenue_over_1b');

    expect(screen.getByText('Showing latest 50 companies')).toBeTruthy();
    expect(screen.queryByText('Showing 2 companies')).toBeNull();
  });

  it('keeps the latest-50 sentence when a later page exists', () => {
    mockList(2, 'c0000000-0000-4000-8000-000000000050');
    renderPage();

    expect(screen.getByText('Showing latest 50 companies')).toBeTruthy();
    expect(screen.queryByText('Showing 2 companies')).toBeNull();
  });

  it('keeps the latest-50 sentence on an empty unfiltered book', () => {
    mockList(0);
    renderPage();

    expect(screen.getByText('Showing latest 50 companies')).toBeTruthy();
    expect(screen.queryByText('Showing 0 companies')).toBeNull();
  });

  it('keeps a search on the search sentence', () => {
    mockList(1, undefined, ['CI Financial']);
    renderPage('/companies?search=CI');

    expect(screen.getByText('1 result for "CI"')).toBeTruthy();
    expect(screen.queryByText('Showing 1 company')).toBeNull();
  });
});
