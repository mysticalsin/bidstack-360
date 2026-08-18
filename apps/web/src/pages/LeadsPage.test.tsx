import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LeadsPage } from './LeadsPage';
import { useLeads } from '@/hooks/useLeads';
import { useHasPermission } from '@/hooks/useCapabilities';

// Lead POST/PATCH/DELETE/convert are gated server-side behind leads:write
// (apps/api/src/routes/leads.write.routes.ts) — the write affordances must
// reflect that instead of rendering controls that always 403 on click.
vi.mock('@/hooks/useLeads', () => ({
  useLeads: vi.fn(),
  useDeleteLead: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useUpdateLeadById: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn() }));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mockLeads(value: Partial<ReturnType<typeof useLeads>>) {
  vi.mocked(useLeads).mockReturnValue(value as ReturnType<typeof useLeads>);
}

function baseLead() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@acme.com',
    phone: null,
    companyName: 'Acme Corp',
    title: 'VP Eng',
    source: 'website',
    status: 'new' as const,
    score: 42,
    priority: 'medium' as const,
    ownerId: null,
    ownerName: null,
    convertedToOpportunityId: null,
    statusChangedAt: new Date().toISOString(),
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

describe('LeadsPage — leads:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeads({
      data: { items: [baseLead()], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('hides New lead and inline-edit triggers, and disables row Delete, for a user without leads:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderWithProviders(<LeadsPage />);

    expect(screen.queryByRole('button', { name: /New lead/i })).toBeNull();
    // Status/priority stop being click-to-edit triggers — the value stays
    // visible as a static badge (the PATCH 403s server-side otherwise).
    expect(screen.queryByRole('button', { name: /^Edit status for/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit priority for/i })).toBeNull();
    // Delete stays visible but disabled with a hint, rather than vanishing.
    const deleteBtn = screen.getByRole('button', { name: /^Delete/i }) as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
    expect(deleteBtn.title).toMatch(/lead write access/i);
    // Read access stays available — the row and its data still render.
    expect(screen.getByText('Jane Doe')).toBeTruthy();
  });

  it('shows New lead and inline-edit triggers, and enables row Delete, for a user with leads:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderWithProviders(<LeadsPage />);

    expect(screen.getByRole('button', { name: /New lead/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Edit status for/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Edit priority for/i })).toBeTruthy();
    const deleteBtn = screen.getByRole('button', { name: /^Delete/i }) as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(false);
  });

  it('hides the empty-state "New lead" action for a user without leads:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    mockLeads({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<LeadsPage />);

    expect(screen.queryByRole('button', { name: /New lead/i })).toBeNull();
  });
});
