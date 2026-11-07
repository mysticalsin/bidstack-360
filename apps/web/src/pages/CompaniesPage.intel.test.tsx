import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCompanies } from '@/hooks/useCompanies';

import { CompaniesPage } from './CompaniesPage';
import { intelSummary } from './companiesPage/__fixtures__/intel-summary';

vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: vi.fn(),
  useCreateCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasAdminPermission: vi.fn(() => true), useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCompanyIntelSummary', () => ({
  useIntelImports: vi.fn(() => ({ data: { items: [] } })),
  useRefreshCompanyIntel: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCompanyIntelSummary: vi.fn(() => ({ data: { summary: null } })),
}));

const company = (over: Record<string, unknown> = {}) => ({
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
  intel: intelSummary(),
  ...over,
});

function renderPage(path = '/companies') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <CompaniesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const INTEL_HEADERS = ['Revenue', 'Revenue growth', 'Headcount', 'Headcount growth (6m)', 'Open roles', 'New roles (30d)', 'Hiring trend', 'Funding', 'Signal', 'Direction'];

describe('CompaniesPage intel columns', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useCompanies).mockReturnValue({ data: { items: [company()], nextCursor: undefined }, isLoading: false, isError: false, error: null } as unknown as ReturnType<typeof useCompanies>);
  });
  afterEach(cleanup);

  it('shows every intel column with values from the summary', () => {
    renderPage();
    const table = screen.getByRole('table');
    for (const h of INTEL_HEADERS) expect(within(table).getByRole('columnheader', { name: new RegExp(`^${h.replace(/[()]/g, '\\$&')}`) })).toBeTruthy();
    expect(within(table).getByText('2.4bn EUR')).toBeTruthy();
    expect(within(table).getByText('Growing')).toBeTruthy();
    expect(within(table).getByText('Acquisition')).toBeTruthy();
  });

  it('offers the three saved views and sends the chosen one to the server', () => {
    renderPage();
    for (const v of ['Hiring fast', 'Revenue over 1B', 'Contracting']) expect(screen.getByRole('button', { name: v })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revenue over 1B' }));
    expect(vi.mocked(useCompanies).mock.calls.at(-1)?.[0]).toMatchObject({ view: 'revenue_over_1b' });
    expect(screen.getByRole('button', { name: 'Revenue over 1B' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('filters by direction on the server', () => {
    renderPage('/companies?direction=contracting');
    expect(vi.mocked(useCompanies).mock.calls.at(-1)?.[0]).toMatchObject({ direction: 'contracting' });
  });

  it('persists column visibility', () => {
    const first = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Funding' }));
    expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: /^Funding/ })).toBeNull();
    first.unmount();
    renderPage();
    expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: /^Funding/ })).toBeNull();
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: /^Revenue$/ })).toBeTruthy();
  });

  it('shows a dash with a reason for companies without intel', () => {
    vi.mocked(useCompanies).mockReturnValue({ data: { items: [company({ intel: null })], nextCursor: undefined }, isLoading: false, isError: false, error: null } as unknown as ReturnType<typeof useCompanies>);
    renderPage();
    const dashes = within(screen.getByRole('table')).getAllByText('\u2013');
    expect(dashes.length).toBeGreaterThanOrEqual(8);
    expect(dashes[0]!.getAttribute('aria-label')).toMatch(/No public data/);
  });
});
