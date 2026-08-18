import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { NewLeadPage } from './NewLeadPage';
import { useHasPermission } from '@/hooks/useCapabilities';

// POST /api/leads is gated server-side behind leads:write
// (apps/api/src/routes/leads.write.routes.ts) — a role without it must see a
// read-only notice instead of a form that always 403s on submit.
vi.mock('@/hooks/useLeads', () => ({
  useCreateLead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn() }));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderWithProviders() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NewLeadPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NewLeadPage — leads:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a read-only notice instead of the create form for a user without leads:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderWithProviders();

    expect(screen.queryByLabelText(/First name/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Create lead/i })).toBeNull();
    expect(
      screen.getByText(/You need lead write access to create a lead/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to leads/i })).toBeTruthy();
  });

  it('renders the full create form for a user with leads:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderWithProviders();

    expect(screen.getByLabelText(/First name/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Create lead/i })).toBeTruthy();
    expect(screen.queryByText(/You need lead write access to create a lead/i)).toBeNull();
  });
});
