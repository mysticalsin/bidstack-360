// A widget with no report used to fall through to ChartContainer's empty
// state ("No data available"). A widget that has a report but no persisted
// run never asked the API to compute one, so the same empty state stuck
// after a successful save. The renderer must say a report is required, and
// must POST /api/reports/:id/run when latestRunId is missing.

import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import type { DashboardWidget } from '@/hooks/useDashboards';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status = 500;
    body: null;
  },
}));

const permissionMocks = vi.hoisted(() => ({ reportsWrite: true }));
vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: (key: string) => key === 'reports:write' && permissionMocks.reportsWrite,
}));

import { WidgetRenderer } from './WidgetRenderer';

const widgetBase: DashboardWidget = {
  id: 'w-1',
  dashboardId: 'd-1',
  title: 'Weighted Pipeline',
  type: 'kpi',
  config: {},
  position: { x: 0, y: 0, w: 3, h: 2 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderWidget(widget: DashboardWidget) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const view = render(<WidgetRenderer widget={widget} />, { wrapper: Wrapper });
  return { ...view, client };
}

afterEach(() => {
  vi.mocked(api).mockReset();
  permissionMocks.reportsWrite = true;
});

describe('WidgetRenderer report binding', () => {
  it('says a widget with no report needs a report, instead of "No data available"', () => {
    renderWidget(widgetBase);

    expect(screen.queryByText(/No data available/i)).toBeNull();
    expect(screen.getByText(/needs a report/i)).toBeTruthy();
  });

  it('runs POST /api/reports/:id/run when the widget has a report but no latestRunId', async () => {
    const reportId = '22222222-2222-4222-8222-222222222222';
    vi.mocked(api).mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      reportId,
      status: 'done',
      result: [{ value: 1 }],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const { client } = renderWidget({ ...widgetBase, reportId, config: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        `/api/reports/${reportId}/run`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['dashboards', 'widgets', widgetBase.dashboardId] }),
      ),
    );
  });

  it('does not POST /reports/:id/run when the viewer lacks reports:write', async () => {
    permissionMocks.reportsWrite = false;
    const reportId = '22222222-2222-4222-8222-222222222222';
    vi.mocked(api).mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      reportId,
      status: 'done',
      result: [{ value: 1 }],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    renderWidget({ ...widgetBase, reportId, config: {} });

    await Promise.resolve();
    const posted = vi.mocked(api).mock.calls.some((call) => {
      const [path, opts] = call;
      return (
        String(path) === `/api/reports/${reportId}/run` &&
        (opts as { method?: string } | undefined)?.method === 'POST'
      );
    });
    expect(posted).toBe(false);
  });

  it('does not run a report that already has a latestRunId', async () => {
    const reportId = '22222222-2222-4222-8222-222222222222';
    vi.mocked(api).mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      reportId,
      status: 'done',
      result: [{ value: 4 }],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    renderWidget({
      ...widgetBase,
      reportId,
      config: { latestRunId: '33333333-3333-4333-8333-333333333333' },
    });

    await Promise.resolve();
    const posted = vi
      .mocked(api)
      .mock.calls.some(
        ([path, opts]) =>
          String(path).endsWith('/run') &&
          (opts as { method?: string } | undefined)?.method === 'POST',
      );
    expect(posted).toBe(false);
  });

  it('formats a currency KPI from micros into units and leaves a number KPI raw', async () => {
    // The seeded pipeline sum is valueMicros. Treating that integer as a unit
    // amount prints 11.89tn. config.format decides which conversion applies.
    const reportId = '22222222-2222-4222-8222-222222222222';
    const runId = '33333333-3333-4333-8333-333333333333';
    const micros = 11_890_000_000_000;
    vi.mocked(api).mockResolvedValue({
      id: runId,
      reportId,
      status: 'done',
      result: [{ value: micros }],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const { unmount } = renderWidget({
      ...widgetBase,
      title: 'Open pipeline',
      reportId,
      config: { format: 'currency', latestRunId: runId },
    });
    const currency = await screen.findByLabelText(/Open pipeline:/i);
    expect(currency.getAttribute('aria-label') ?? '').not.toMatch(/tn/i);
    expect(currency.getAttribute('aria-label') ?? '').not.toContain(String(micros));
    expect(currency.getAttribute('aria-label') ?? '').toMatch(/11\.89/);
    unmount();

    renderWidget({
      ...widgetBase,
      title: 'Raw count',
      reportId,
      config: { format: 'number', latestRunId: runId },
    });
    const raw = await screen.findByLabelText(/Raw count:/i);
    expect(raw.getAttribute('aria-label') ?? '').toMatch(/tn/i);
  });
});
