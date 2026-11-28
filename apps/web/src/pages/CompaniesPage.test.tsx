import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CompaniesPage } from './CompaniesPage';
import { useCompanies } from '@/hooks/useCompanies';
import { useHasAdminPermission } from '@/hooks/useCapabilities';

// Companies POST/PATCH/DELETE are gated server-side behind companies:write +
// the literal 'admin' role (apps/api/src/routes/companies.ts) — the write
// affordances must reflect that AND-of-both gate, not just the permission
// grant alone (useHasPermission's isAdmin-OR would show controls a
// permission-holding non-admin gets 403'd on). useHasPermission is mocked to
// true so the "gate holds" assertions below prove the page consults
// useHasAdminPermission — a regression back to the permission-only hook would
// render the controls and fail those tests. (Children like DuplicatesDialog
// legitimately use useHasPermission for their own permission-only routes.)
vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: vi.fn(),
  useCreateCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasAdminPermission: vi.fn(),
  useHasPermission: vi.fn(() => true),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mockCompanies(value: Partial<ReturnType<typeof useCompanies>>) {
  vi.mocked(useCompanies).mockReturnValue(value as ReturnType<typeof useCompanies>);
}

function baseCompany() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    orgId: '22222222-2222-2222-2222-222222222222',
    name: 'Acme Corp',
    legalName: null,
    domain: 'acme.com',
    industry: 'Consulting',
    employeeCount: 500,
    countryCode: 'FR',
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
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CompaniesPage — companies:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanies({
      data: { items: [baseCompany()], nextCursor: undefined },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('hides New company and row Delete for a user without companies:write', () => {
    vi.mocked(useHasAdminPermission).mockReturnValue(false);

    renderWithProviders(<CompaniesPage />);

    expect(screen.queryByRole('button', { name: /New company/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull();
    // The read affordance stays available — only writes are gated.
    expect(screen.getByRole('link', { name: /View/i })).toBeTruthy();
  });

  it('shows New company and row Delete for a user with companies:write', () => {
    vi.mocked(useHasAdminPermission).mockReturnValue(true);

    renderWithProviders(<CompaniesPage />);

    expect(screen.getByRole('button', { name: /New company/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete/i })).toBeTruthy();
  });

  it('hides the empty-state "Add company" action for a user without companies:write', () => {
    vi.mocked(useHasAdminPermission).mockReturnValue(false);
    mockCompanies({
      data: { items: [], nextCursor: undefined },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithProviders(<CompaniesPage />);

    expect(screen.queryByRole('button', { name: /Add company/i })).toBeNull();
    // A settled empty book may use the count sentence. A missing read may not.
    // This suite does not interpolate, so the sentence stays the message template.
    expect(screen.getByText('{{count}} companies visible.')).toBeTruthy();
    expect(screen.queryByText('Loading the company list.')).toBeNull();
  });

  it('checks the admin+permission gate, not just the permission grant', () => {
    // A non-admin holding the raw companies:write grant must still see the
    // controls hidden — the server 403s them regardless (requireRole('admin')
    // stacks on top of requirePermission). useHasAdminPermission is called
    // with the exact key the server checks; asserting the call args pins the
    // wiring so a regression to the wrong key/hook fails here.
    vi.mocked(useHasAdminPermission).mockReturnValue(false);

    renderWithProviders(<CompaniesPage />);

    expect(useHasAdminPermission).toHaveBeenCalledWith('companies:write');
    expect(screen.queryByRole('button', { name: /New company/i })).toBeNull();
  });

  // WHY: the header and the summary used the missing page as "0 companies
  // visible" while the request was still out. On the demo book that flash
  // says the account list is empty before the companies arrive.
  it('does not call an in-flight list an empty book', () => {
    vi.mocked(useHasAdminPermission).mockReturnValue(true);
    mockCompanies({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<CompaniesPage />);

    expect(screen.queryByText('{{count}} companies visible.')).toBeNull();
    expect(screen.queryByText('Showing latest 50 companies')).toBeNull();
    expect(screen.queryByText('Visible companies')).toBeNull();
    expect(screen.queryByText('No accounts on the radar')).toBeNull();
    expect(screen.getByText('Loading the company list.')).toBeTruthy();
  });

  // WHY: a failed read is not an empty book, and an error with no control
  // leaves the list stranded. Retry reloads the same read.
  it('retries a failed list instead of saying there are no companies', () => {
    vi.mocked(useHasAdminPermission).mockReturnValue(true);
    const refetch = vi.fn();
    mockCompanies({
      data: undefined,
      isLoading: false,
      isError: true,
      error: null,
      refetch,
    });

    renderWithProviders(<CompaniesPage />);

    expect(screen.queryByText('{{count}} companies visible.')).toBeNull();
    expect(screen.queryByText('Showing latest 50 companies')).toBeNull();
    expect(screen.queryByText('No accounts on the radar')).toBeNull();
    expect(screen.getByText('The company list did not load.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Failed to load companies' })).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('h-11');
    expect(retry.className).toContain('focus-visible:ring-2');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // WHY: a failed refresh is not a new empty book. The last rows stay.
  it('keeps the last companies when a later refresh fails', () => {
    vi.mocked(useHasAdminPermission).mockReturnValue(true);
    mockCompanies({
      data: { items: [baseCompany()], nextCursor: undefined },
      isLoading: false,
      isError: true,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<CompaniesPage />);

    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.queryByText('No accounts on the radar')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Failed to load companies' })).toBeNull();
  });
});
