// The seeded Pre-sales Command Center widgets have no reportId. Before this,
// WidgetRenderer treated "no report run" as an empty series and ChartContainer
// said "No data available for this time period" even when GET /api/reports/pipeline
// had open deals. These widgets must read that snapshot instead.
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardWidget } from '@/hooks/useDashboards';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'en' },
  }),
}));

const pipelineMocks = vi.hoisted(() => ({
  usePipelineReport: vi.fn(),
}));
vi.mock('@/hooks/usePipelineReport', () => pipelineMocks);

vi.mock('@/hooks/useAnalyticsReports', () => ({
  useReportRun: () => ({ data: undefined, isLoading: false, error: null }),
  useRunReport: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/components/charts/KpiCard', () => ({
  KpiCard: ({ title, value }: { title: string; value: number }) => (
    <div data-testid="kpi">
      {title}:{value}
    </div>
  ),
}));

vi.mock('@/components/charts/charts', () => ({
  BarChart: ({ data }: { data: { name: string; value: number }[] }) => (
    <ul data-testid="bars">
      {data.map((row) => (
        <li key={row.name}>
          {row.name}:{row.value}
        </li>
      ))}
    </ul>
  ),
  LineChart: () => null,
  AreaChart: () => null,
  PieChart: () => null,
  DonutChart: () => null,
  FunnelChart: () => null,
  GaugeChart: () => null,
  HeatmapChart: () => null,
  ScatterChart: () => null,
  RadarChart: () => null,
  TableChart: () => null,
}));

import { WidgetRenderer } from './WidgetRenderer';

const pipeline = {
  weightedPipeline: 1_240_000,
  byStage: [
    { stage: 's4_negotiation', count: 1, valueSum: 4_800_000 },
    { stage: 'closed_won', count: 2, valueSum: 900_000 },
    { stage: 's1_ongoing', count: 3, valueSum: 3_700_000 },
  ],
  totalOpen: 4,
  totalValueOpen: 8_500_000,
  velocity: { avgDaysOpen: 12, closedThisQuarter: 1 },
};

function widget(overrides: Partial<DashboardWidget> = {}): DashboardWidget {
  return {
    id: 'w-1',
    dashboardId: 'd-1',
    title: 'Weighted Pipeline',
    type: 'kpi',
    config: { format: 'currency', subtitle: 'Open opportunities, probability-weighted' },
    position: { x: 0, y: 0, w: 3, h: 2 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderWidget(w: DashboardWidget) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<WidgetRenderer widget={w} />, { wrapper: Wrapper });
}

describe('WidgetRenderer seeded pipeline widgets', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the live weighted pipeline instead of an empty time period', () => {
    pipelineMocks.usePipelineReport.mockReturnValue({
      data: pipeline,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWidget(widget());

    expect(screen.queryByText(/no data available for this time period/i)).toBeNull();
    expect(screen.getByTestId('kpi').textContent).toBe('Weighted Pipeline:1240000');
  });

  it('charts open stages by name and leaves closed deals out', () => {
    pipelineMocks.usePipelineReport.mockReturnValue({
      data: pipeline,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWidget(
      widget({
        id: 'w-2',
        title: 'Pipeline by Stage',
        type: 'bar',
        config: { subtitle: 'Open opportunity value grouped by sales stage' },
      }),
    );

    expect(screen.queryByText(/no data available for this time period/i)).toBeNull();
    const names = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(names).toEqual(['S1 Ongoing:3700000', 'S4 Negotiation:4800000']);
    expect(names.join(' ')).not.toMatch(/closed/i);
  });

  it('holds the empty-period copy while the pipeline read is still settling', () => {
    pipelineMocks.usePipelineReport.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderWidget(widget());

    expect(screen.queryByText(/no data available for this time period/i)).toBeNull();
    expect(screen.getByRole('status', { name: /loading chart/i })).toBeTruthy();
  });

  it('says there are no open deals when every stage is already closed', () => {
    pipelineMocks.usePipelineReport.mockReturnValue({
      data: {
        ...pipeline,
        weightedPipeline: 0,
        byStage: [{ stage: 'closed_won', count: 2, valueSum: 900_000 }],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWidget(
      widget({
        id: 'w-2',
        title: 'Pipeline by Stage',
        type: 'bar',
        config: { subtitle: 'Open opportunity value grouped by sales stage' },
      }),
    );

    expect(screen.queryByText(/no data available for this time period/i)).toBeNull();
    expect(screen.getByText(/no open deals to chart/i)).toBeTruthy();
  });

  it('says the pipeline read failed instead of claiming the period is empty', () => {
    pipelineMocks.usePipelineReport.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('pipeline unavailable'),
      refetch: vi.fn(),
    });

    renderWidget(widget());

    expect(screen.queryByText(/no data available for this time period/i)).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/pipeline unavailable/);
  });
});
