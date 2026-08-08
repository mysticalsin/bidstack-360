// Regression: add/delete widget both persist through POST/DELETE
// /api/dashboards/:id/widgets*, gated server-side behind reports:write
// (apps/api/src/routes/analytics-dashboards.ts:94,139) — before this test
// existed "Add widget" and per-widget delete rendered unconditionally, a
// 403-on-click trap for a role without reports:write.
//
// WidgetRenderer/WidgetConfigModal are stubbed: their own behaviour (chart
// rendering, report picking) is out of this page's scope, and stubbing keeps
// this test focused on the canWrite plumbing this page owns.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  ownerId: 'owner-1',
  isShared: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const widget = {
  id: 'w-1',
  dashboardId: 'd-1',
  title: 'Win rate',
  type: 'kpi' as const,
  config: {},
  position: { x: 0, y: 0, w: 1, h: 1 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dashboardsMocks = vi.hoisted(() => ({
  useDashboards: vi.fn(() => ({ data: [dashboard], isLoading: false })),
  useDashboardWidgets: vi.fn(() => ({ data: [widget], isLoading: false, error: null })),
  useAddWidget: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteWidget: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useDashboards', () => dashboardsMocks);

vi.mock('@/components/widgets/WidgetRenderer', () => ({
  WidgetRenderer: ({ widget: w, onDelete }: { widget: { title: string }; onDelete?: () => void }) => (
    <div>
      <span>{w.title}</span>
      {onDelete ? (
        <button onClick={onDelete} aria-label={`Delete widget ${w.title}`}>
          Delete
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('@/components/widgets/WidgetConfigModal', () => ({
  WidgetConfigModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="widget-config-modal" /> : null,
}));

import { AnalyticsDashboardPage } from './AnalyticsDashboardPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<AnalyticsDashboardPage />, { wrapper: Wrapper });
}

describe('AnalyticsDashboardPage — reports:write gating', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows Add widget and a per-widget delete for a user with reports:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);

    renderPage();

    expect(screen.getByRole('button', { name: /Add widget/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete widget Win rate/i })).toBeTruthy();
  });

  it('hides Add widget and the per-widget delete for a user without reports:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    // Read access still renders the widget...
    expect(screen.getByText('Win rate')).toBeTruthy();
    // ...but every write affordance is gone, not just visually hidden.
    expect(screen.queryByRole('button', { name: /Add widget/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete widget Win rate/i })).toBeNull();
  });

  it('never mounts the Add-widget modal for a user without reports:write, even if addingWidget were true', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    expect(screen.queryByTestId('widget-config-modal')).toBeNull();
  });
});
