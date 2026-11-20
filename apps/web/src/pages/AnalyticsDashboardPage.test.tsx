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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const modalMocks = vi.hoisted(() => ({ useReal: false }));
const reportMocks = vi.hoisted(() => ({
  useAnalyticsReportsList: vi.fn(() => ({ data: [] as Array<{ id: string; name: string }> })),
}));
vi.mock('@/hooks/useAnalyticsReports', () => ({
  useAnalyticsReportsList: reportMocks.useAnalyticsReportsList,
}));

const dashboard = {
  id: 'd-1',
  orgId: 'org-1',
  name: 'Pipeline Overview',
  ownerId: 'owner-1',
  isShared: true,
  // Server-computed: true for the owner and for an org admin. The default
  // fixture is that caller, so the reports:write tests keep a visible editor.
  canEdit: true,
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
  WidgetRenderer: ({
    widget: w,
    onDelete,
  }: {
    widget: { title: string };
    onDelete?: () => void;
  }) => (
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

type WidgetConfigModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: {
    title: string;
    type: string;
    reportId?: string;
    config?: Record<string, unknown>;
  }) => void | Promise<void>;
};

vi.mock('@/components/widgets/WidgetConfigModal', async () => {
  const actual = (await vi.importActual('@/components/widgets/WidgetConfigModal')) as {
    WidgetConfigModal: (props: WidgetConfigModalProps) => ReactNode;
  };
  return {
    WidgetConfigModal: (props: WidgetConfigModalProps) =>
      modalMocks.useReal ? (
        <actual.WidgetConfigModal {...props} />
      ) : (
        // Mounted even while closed, so a test can tell "the page never
        // offered the modal" from "the modal is closed".
        <div data-testid="widget-config-modal" data-open={props.open ? 'true' : 'false'} />
      ),
  };
});

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

describe('AnalyticsDashboardPage states', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    dashboardsMocks.useDashboards.mockImplementation(() => ({
      data: [dashboard],
      isLoading: false,
    }));
    dashboardsMocks.useDashboardWidgets.mockImplementation(() => ({
      data: [widget],
      isLoading: false,
      error: null,
    }));
  });

  it('shows an error with a retry, not "No dashboards", when the list fails to load', () => {
    const refetch = vi.fn();
    dashboardsMocks.useDashboards.mockImplementation(
      () =>
        ({
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error('boom'),
          refetch,
        }) as never,
    );

    renderPage();

    expect(screen.queryByText('No dashboards')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps showing cached dashboards when a background refetch fails', () => {
    dashboardsMocks.useDashboards.mockImplementation(
      () =>
        ({
          data: [dashboard],
          isLoading: false,
          isError: true,
          error: new Error('boom'),
          refetch: vi.fn(),
        }) as never,
    );

    renderPage();

    expect(screen.queryByText('Could not load dashboards')).toBeNull();
    expect(screen.getAllByText('Pipeline Overview').length).toBeGreaterThan(0);
  });

  it('shows a loading grid while the widgets load', () => {
    dashboardsMocks.useDashboardWidgets.mockImplementation(
      () => ({ data: undefined, isLoading: true, error: null }) as never,
    );

    renderPage();

    expect(screen.getByTestId('widgets-loading')).toBeTruthy();
  });

  it('closes the dashboard switcher on Escape', () => {
    renderPage();

    const trigger = screen.getByRole('button', { name: /Switch dashboard/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('AnalyticsDashboardPage — who may add a widget', () => {
  afterEach(() => {
    cleanup();
    modalMocks.useReal = false;
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    dashboardsMocks.useDashboards.mockImplementation(() => ({
      data: [dashboard],
      isLoading: false,
    }));
    dashboardsMocks.useDashboardWidgets.mockImplementation(() => ({
      data: [widget],
      isLoading: false,
      error: null,
    }));
    dashboardsMocks.useAddWidget.mockImplementation(() => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }));
  });

  function renderSharedBoard(caller: { name: string; canEdit: boolean }) {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    dashboardsMocks.useDashboards.mockImplementation(() => ({
      data: [{ ...dashboard, name: caller.name, isShared: true, canEdit: caller.canEdit }],
      isLoading: false,
    }));
    dashboardsMocks.useDashboardWidgets.mockImplementation(() => ({
      data: [],
      isLoading: false,
      error: null,
    }));
    renderPage();
  }

  it('hides Add widget, the empty-state CTA, and the modal from a reports:write user who neither owns the shared dashboard nor is an admin, and shows them to the owner and to an admin', () => {
    // canEdit is the server's owner-or-admin answer on this shared dashboard.
    renderSharedBoard({ name: 'Owned by me', canEdit: true });
    expect(screen.getByRole('button', { name: /Switch dashboard/i }).textContent).toContain(
      'Owned by me',
    );
    expect(screen.getAllByRole('button', { name: /Add widget/i })).toHaveLength(2);
    expect(screen.getByTestId('widget-config-modal')).toBeTruthy();

    cleanup();
    renderSharedBoard({ name: 'Shared, visible to an admin', canEdit: true });
    expect(screen.getByRole('button', { name: /Switch dashboard/i }).textContent).toContain(
      'Shared, visible to an admin',
    );
    expect(screen.getAllByRole('button', { name: /Add widget/i })).toHaveLength(2);
    expect(screen.getByTestId('widget-config-modal')).toBeTruthy();

    cleanup();
    renderSharedBoard({ name: 'Shared team board', canEdit: false });
    expect(screen.getByRole('button', { name: /Switch dashboard/i }).textContent).toContain(
      'Shared team board',
    );
    expect(screen.queryAllByRole('button', { name: /Add widget/i })).toHaveLength(0);
    expect(screen.queryByTestId('widget-config-modal')).toBeNull();
    expect(screen.getByText('Empty dashboard')).toBeTruthy();
  });

  it('shows the rejected save reason inline in the modal and leaves the dialog open', async () => {
    modalMocks.useReal = true;
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    const reportId = '11111111-1111-4111-8111-111111111111';
    reportMocks.useAnalyticsReportsList.mockReturnValue({
      data: [{ id: reportId, name: 'Open pipeline' }],
    });
    const mutateAsync = vi.fn().mockRejectedValue(
      new Error('Only the owner or an admin can modify this dashboard'),
    );
    dashboardsMocks.useAddWidget.mockImplementation(() => ({ mutateAsync, isPending: false }));

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Add widget/i }));
    fireEvent.change(await screen.findByLabelText(/Data source/i), { target: { value: reportId } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save widget' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Only the owner or an admin can modify this dashboard');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save widget' })).toBeTruthy();
    expect(mutateAsync).toHaveBeenCalled();
  });
});
