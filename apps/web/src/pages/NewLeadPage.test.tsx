import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { NewLeadPage } from './NewLeadPage';

// POST /api/leads is gated server-side behind leads:write
// (apps/api/src/routes/leads.write.routes.ts). A settled manifest without
// that grant shows a read-only notice instead of a form that would 403.
const caps = vi.hoisted(() => ({
  current: {
    data: { isAdmin: false, permissions: [] as string[] } as
      | { isAdmin: boolean; permissions: string[] }
      | null
      | undefined,
    isError: false,
    status: 'success' as string,
  },
}));

vi.mock('@/hooks/useLeads', () => ({
  useCreateLead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => caps.current,
}));

function settled(permissions: string[]) {
  caps.current = {
    data: { isAdmin: false, permissions },
    isError: false,
    status: 'success',
  };
}

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

describe('NewLeadPage leads:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a read-only notice instead of the create form for a user without leads:write', () => {
    settled([]);

    renderWithProviders();

    expect(screen.queryByLabelText(/First name/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Create lead/i })).toBeNull();
    expect(
      screen.getByText(/You need lead write access to create a lead/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to leads/i })).toBeTruthy();
  });

  it('renders the full create form for a user with leads:write', () => {
    settled(['leads:write']);

    renderWithProviders();

    expect(screen.getByLabelText(/First name/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Create lead/i })).toBeTruthy();
    expect(screen.queryByText(/You need lead write access to create a lead/i)).toBeNull();
  });

  it('carries no tagline under the heading', () => {
    settled(['leads:write']);

    renderWithProviders();

    expect(screen.getByRole('heading', { name: 'New lead' })).toBeTruthy();
    expect(screen.queryByText(/Add a new prospect to your pipeline/i)).toBeNull();
  });
});
