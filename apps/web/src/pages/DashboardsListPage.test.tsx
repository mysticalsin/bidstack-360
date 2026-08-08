// Regression: create/delete both persist through POST/DELETE
// /api/dashboards, gated server-side behind reports:write
// (apps/api/src/routes/analytics-dashboards.ts:94,139) — before this test
// existed "New dashboard" and per-card delete rendered unconditionally, a
// 403-on-click trap for a role without reports:write.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const dashboard = {
  id: 'd-1',
  orgId: 'org-1',
  name: 'Pipeline Overview',
  description: 'Weekly pipeline health',
  ownerId: 'owner-1',
  isShared: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dashboardsMocks = vi.hoisted(() => ({
  useDashboards: vi.fn(),
  useCreateDashboard: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteDashboard: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useDashboards', () => dashboardsMocks);

import { DashboardsListPage } from './DashboardsListPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<DashboardsListPage />, { wrapper: Wrapper });
}

describe('DashboardsListPage — reports:write gating', () => {
  beforeEach(() => {
    dashboardsMocks.useDashboards.mockReturnValue({
      data: [dashboard],
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows New dashboard and an enabled delete affordance for a user with reports:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);

    renderPage();

    expect(screen.getByRole('button', { name: /New dashboard/i })).toBeTruthy();
    const deleteButton = screen.getByRole('button', {
      name: /Delete dashboard Pipeline Overview/i,
    });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('hides New dashboard and disables delete for a user without reports:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    // Read access still lists the dashboard...
    expect(screen.getByText('Pipeline Overview')).toBeTruthy();
    // ...but every write affordance is gone or disabled, not just visually hidden.
    expect(screen.queryByRole('button', { name: /New dashboard/i })).toBeNull();
    const deleteButton = screen.getByRole('button', {
      name: /Delete dashboard Pipeline Overview/i,
    });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
    expect(deleteButton.getAttribute('title')).toBe(
      'You need reports write access to manage dashboards.',
    );
  });
});
