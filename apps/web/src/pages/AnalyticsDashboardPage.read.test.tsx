// The analytics door is the demo command center. Until that list arrives,
// "No dashboards" is a workspace the page invented. A paused read has no
// payload and isLoading is false, so the empty state fires. An unread read
// is the same lie. An in-flight read paints only a pulse grid, with no
// sentence that the list is still out. A failed read with no payload is
// not an empty workspace. A later failure keeps the dashboard already on
// screen. A settled empty list still says "No dashboards".
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

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

const DEMO_DASHBOARD_NAME = 'Pre-sales Command Center';
const CHECKING = 'Checking dashboards. They have not arrived.';
const FAILED = 'Could not load dashboards';
const EMPTY = 'No dashboards';
const EMPTY_MESSAGE = 'Create your first dashboard to start visualising your data.';

const demoDashboard = {
  id: 'da5b0000-0000-4000-8000-000000000001',
  orgId: 'org-demo',
  name: DEMO_DASHBOARD_NAME,
  description: 'Pipeline health, win rate, and bid coverage at a glance.',
  ownerId: 'user-demo',
  isShared: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const demoWidgets = [
  {
    id: 'da5b0000-0000-4000-8000-000000000011',
    dashboardId: demoDashboard.id,
    title: 'Weighted Pipeline',
    type: 'kpi' as const,
    config: {},
    position: { x: 0, y: 0, w: 3, h: 2 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'da5b0000-0000-4000-8000-000000000012',
    dashboardId: demoDashboard.id,
    title: 'Pipeline by Stage',
    type: 'bar' as const,
    config: {},
    position: { x: 3, y: 0, w: 6, h: 4 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

type ReadStatus = {
  data: unknown;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isPaused: boolean;
  isError: boolean;
  fetchStatus: 'idle' | 'paused' | 'fetching';
  error: Error | null;
  refetch: () => void;
};

function readStatus(next: Partial<ReadStatus> = {}): ReadStatus {
  return {
    data: undefined,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isPaused: false,
    isError: false,
    fetchStatus: 'idle',
    error: null,
    refetch: vi.fn(),
    ...next,
  };
}

const dashboardMocks = vi.hoisted(() => ({
  useDashboards: vi.fn(),
  useDashboardWidgets: vi.fn(),
  useAddWidget: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteWidget: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useDashboards', () => dashboardMocks);

vi.mock('@/components/widgets/WidgetRenderer', () => ({
  WidgetRenderer: ({ widget: w }: { widget: { title: string } }) => <span>{w.title}</span>,
}));

vi.mock('@/components/widgets/WidgetConfigModal', () => ({
  WidgetConfigModal: () => null,
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

function mockDashboards(next: Partial<ReadStatus>) {
  dashboardMocks.useDashboards.mockReturnValue(readStatus(next));
  dashboardMocks.useDashboardWidgets.mockReturnValue(
    readStatus({ data: undefined, isPending: true, fetchStatus: 'idle' }),
  );
}

function expectNotInventedEmpty() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  expect(screen.queryByRole('link', { name: /Create dashboard/i })).toBeNull();
  expect(screen.queryByText(DEMO_DASHBOARD_NAME)).toBeNull();
  expect(screen.queryByText('Weighted Pipeline')).toBeNull();
}

describe('AnalyticsDashboardPage dashboard list read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call an unread dashboard list empty', () => {
    // WHY: the demo page paints before the dashboard request starts.
    // fetchStatus is idle and isLoading is false, so a missing payload
    // becomes "No dashboards". The demo seed has Pre-sales Command Center.
    // That list has not been read. It is not an empty workspace.
    mockDashboards({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotInventedEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call a paused dashboard list empty', () => {
    // WHY: a paused read (offline demo tab) has no dashboards. isLoading is
    // false because the fetch is not running. "No dashboards" would say the
    // command center already came back empty.
    mockDashboards({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotInventedEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight dashboard list empty', () => {
    // WHY: the first fetch still has no payload. A pulse grid with no
    // sentence reads as a blank workspace. The demo command center has not
    // arrived, and hiding the Analytics heading would say the page is missing.
    mockDashboards({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotInventedEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call a failed dashboard list an empty workspace', () => {
    // WHY: a failed list read is not zero dashboards. "No dashboards" would
    // invite a second command center while the demo one was never read.
    const refetch = vi.fn();
    mockDashboards({
      isError: true,
      error: new Error('Dashboard list unavailable'),
      refetch,
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expectNotInventedEmpty();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('keeps a settled empty dashboard list empty', () => {
    // WHY: a list that arrived with no rows really is empty. "No dashboards"
    // is that result, not a missing payload.
    mockDashboards({ data: [] });
    renderPage();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Create dashboard/i })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a loaded demo dashboard on the page', () => {
    // WHY: a payload that arrived, including the synthetic demo command
    // center and its two widgets, still shows. The hold is only for a list
    // that has not arrived.
    dashboardMocks.useDashboards.mockReturnValue(readStatus({ data: [demoDashboard] }));
    dashboardMocks.useDashboardWidgets.mockReturnValue(readStatus({ data: demoWidgets }));
    renderPage();

    expect(screen.getAllByText(DEMO_DASHBOARD_NAME).length).toBeGreaterThan(0);
    expect(screen.getByText('Weighted Pipeline')).toBeTruthy();
    expect(screen.getByText('Pipeline by Stage')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('keeps a loaded dashboard when a later read fails', () => {
    // WHY: a refresh that fails does not erase the command center already
    // on screen and does not replace it with "No dashboards". The failure
    // sentence is for a read that never arrived.
    dashboardMocks.useDashboards.mockReturnValue(
      readStatus({
        data: [demoDashboard],
        isError: true,
        isFetching: false,
        error: new Error('Dashboard list unavailable'),
      }),
    );
    dashboardMocks.useDashboardWidgets.mockReturnValue(readStatus({ data: demoWidgets }));
    renderPage();

    expect(screen.getAllByText(DEMO_DASHBOARD_NAME).length).toBeGreaterThan(0);
    expect(screen.getByText('Weighted Pipeline')).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Dashboard list unavailable')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
