// A saved intel view or a direction is a filter. On the demo book "Revenue
// over 1B" and "Contracting" can match nothing. That miss used to read as an
// empty org: "No accounts on the radar", "Add company", and a CSV import, and
// the status still said the latest 50 companies were showing. A search miss
// already has its own sentence. This file fails if a view or direction miss
// falls back to the empty book.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCompanies } from '@/hooks/useCompanies';

import { CompaniesPage } from './CompaniesPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(values[name] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: vi.fn(),
  useCreateCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasAdminPermission: vi.fn(() => true),
  useHasPermission: vi.fn(() => true),
}));

vi.mock('@/hooks/useCompanyIntelSummary', () => ({
  useIntelImports: vi.fn(() => ({ data: { items: [] } })),
  useRefreshCompanyIntel: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCompanyIntelSummary: vi.fn(() => ({ data: { summary: null } })),
}));

function company() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    orgId: '22222222-2222-2222-2222-222222222222',
    name: 'Acme Corp',
    legalName: null,
    domain: 'acme.com',
    industry: 'Banking',
    employeeCount: 500,
    countryCode: 'NO',
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    intel: null,
  };
}

function mockList(items: ReturnType<typeof company>[]) {
  vi.mocked(useCompanies).mockReturnValue({
    data: { items, nextCursor: undefined },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useCompanies>);
}

function renderPage(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
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

describe('Companies list filter miss', () => {
  it('does not call a Revenue over 1B miss an empty book', () => {
    mockList([]);
    renderPage('/companies?view=revenue_over_1b');

    expect(screen.getByRole('heading', { name: 'No companies match these filters' })).toBeTruthy();
    expect(screen.getByText('Revenue over 1B matched no companies.')).toBeTruthy();
    expect(screen.getByText('Showing Revenue over 1B')).toBeTruthy();
    expect(screen.queryByText('No accounts on the radar')).toBeNull();
    expect(screen.queryByText('Showing latest 50 companies')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add company' })).toBeNull();
    expect(screen.queryByRole('link', { name: /import accounts from CSV/i })).toBeNull();
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    expect(clear.className).toContain('h-11');
    expect(clear.className).toContain('focus-visible:ring-2');

    fireEvent.click(clear);

    expect(screen.getByText('No accounts on the radar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add company' })).toBeTruthy();
    const last = vi.mocked(useCompanies).mock.calls.at(-1)?.[0];
    expect(last).not.toMatchObject({ view: 'revenue_over_1b' });
    expect(last).not.toHaveProperty('view');
  });

  it('names a direction miss and does not offer a new company', () => {
    mockList([]);
    renderPage('/companies?direction=contracting');

    expect(screen.getByText('Contracting matched no companies.')).toBeTruthy();
    expect(screen.getByText('Showing Contracting')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add company' })).toBeNull();
    expect(screen.queryByText('Showing latest 50 companies')).toBeNull();
  });

  it('names the view on a page that has rows, instead of the latest 50', () => {
    mockList([company()]);
    renderPage('/companies?view=revenue_over_1b');

    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.getByText('Showing Revenue over 1B')).toBeTruthy();
    expect(screen.queryByText('Showing latest 50 companies')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No companies match these filters' })).toBeNull();
  });

  it('keeps a search miss on the search sentence', () => {
    mockList([]);
    renderPage('/companies?search=acme');

    expect(screen.getByRole('heading', { name: 'No companies match your search' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No companies match these filters' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.queryByText('No accounts on the radar')).toBeNull();
  });

  it('keeps an unfiltered empty book on the add-company empty state', () => {
    mockList([]);
    renderPage('/companies');

    expect(screen.getByText('No accounts on the radar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add company' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /import accounts from CSV/i })).toBeTruthy();
    expect(screen.getByText('Showing latest 50 companies')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('names the search and the view together, and clear drops both', () => {
    mockList([]);
    renderPage('/companies?view=hiring_fast&search=acme&direction=growing');

    expect(screen.getByText('Nothing matched "acme" in Hiring fast, Growing.')).toBeTruthy();
    expect(screen.queryByText('No accounts on the radar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    const last = vi.mocked(useCompanies).mock.calls.at(-1)?.[0];
    expect(last).not.toHaveProperty('view');
    expect(last).not.toHaveProperty('direction');
    expect(last?.search).toBeFalsy();
  });
});
