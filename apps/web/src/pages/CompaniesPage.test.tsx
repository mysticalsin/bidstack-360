import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CompaniesPage } from './CompaniesPage';
import { useCompanies } from '@/hooks/useCompanies';
import { useHasPermission } from '@/hooks/useCapabilities';

// Companies POST/PATCH/DELETE are gated server-side behind companies:write +
// the literal 'admin' role (apps/api/src/routes/companies.ts) — the write
// affordances must reflect that, not just show a button that always 403s.
vi.mock('@/hooks/useCompanies', () => ({
  useCompanies: vi.fn(),
  useCreateCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteCompany: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn() }));

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
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderWithProviders(<CompaniesPage />);

    expect(screen.queryByRole('button', { name: /New company/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull();
    // The read affordance stays available — only writes are gated.
    expect(screen.getByRole('link', { name: /View/i })).toBeTruthy();
  });

  it('shows New company and row Delete for a user with companies:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderWithProviders(<CompaniesPage />);

    expect(screen.getByRole('button', { name: /New company/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete/i })).toBeTruthy();
  });

  it('hides the empty-state "Add company" action for a user without companies:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    mockCompanies({
      data: { items: [], nextCursor: undefined },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithProviders(<CompaniesPage />);

    expect(screen.queryByRole('button', { name: /Add company/i })).toBeNull();
  });
});
