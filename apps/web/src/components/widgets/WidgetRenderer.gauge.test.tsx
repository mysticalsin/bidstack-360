// A gauge on Analytics reads the report row. The add-widget form stores yKey
// and never a gaugeValue, so the old fallback painted 0% over a real figure.
// The demo closed book is one win and one loss (50). An average over no rows
// is null, and that is not a zero percent either.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardWidget } from '@/hooks/useDashboards';

const reportMocks = vi.hoisted(() => ({
  useReportRun: vi.fn(),
}));

vi.mock('@/hooks/useAnalyticsReports', () => ({
  useReportRun: reportMocks.useReportRun,
  useRunReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { WidgetRenderer } from './WidgetRenderer';

function widget(): DashboardWidget {
  return {
    id: 'w-gauge',
    dashboardId: 'd-1',
    reportId: 'report-1',
    title: 'Win rate',
    type: 'gauge',
    config: { xKey: 'name', yKey: 'value', latestRunId: 'run-1' },
    position: { x: 0, y: 0, w: 4, h: 3 },
    createdAt: '2026-11-25T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
  };
}

function renderGauge(result: Array<Record<string, unknown>>) {
  reportMocks.useReportRun.mockReturnValue({
    data: { id: 'run-1', reportId: 'report-1', status: 'done', result },
    isLoading: false,
    error: null,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<WidgetRenderer widget={widget()} />, { wrapper: Wrapper });
}

describe('analytics gauge widget', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the report figure, not 0%, when the row has a win rate', () => {
    renderGauge([{ value: 50 }]);

    const meter = screen.getByRole('meter', { name: 'Win rate' });
    expect(meter.getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('keeps a real zero when the report figure is zero', () => {
    renderGauge([{ value: 0 }]);

    expect(screen.getByRole('meter', { name: 'Win rate' }).getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('does not call a null average 0%', () => {
    renderGauge([{ value: null }]);

    expect(screen.queryByRole('meter', { name: 'Win rate' })).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.getByText('No figure for this gauge.')).toBeTruthy();
  });
});
