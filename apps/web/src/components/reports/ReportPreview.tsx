// ReportPreview — live result pane for the report builder. Renders the rows
// returned by a preview/saved run as the chosen chart type, with a robust
// TableChart fallback and an error boundary so a chart-shape mismatch can't
// crash the builder. xKey/yKey are DERIVED from the query (the engine's
// contract: group keys aliased by field, a lone aggregate aliased 'value'),
// never free-typed.

import { Component, type ReactNode } from 'react';

import { ChartContainer } from '@/components/charts/ChartContainer';
import {
  AreaChart,
  BarChart,
  DonutChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  TableChart,
} from '@/components/charts/charts';
import type { ChartType, ReportQuery, ReportRun } from '@/hooks/useAnalyticsReports';

type Row = Record<string, unknown>;

class PreviewErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, message: err instanceof Error ? err.message : 'Chart render error' };
  }
  override render() {
    if (this.state.hasError) {
      return (
        <p role="alert" className="py-6 text-center text-xs text-[var(--danger)]">
          This chart type doesn&rsquo;t fit the current query shape. The table below shows the raw
          rows.
        </p>
      );
    }
    return this.props.children;
  }
}

function deriveKeys(query: ReportQuery): { xKey: string; yKey: string } {
  const xKey = query.groupBy?.[0]?.field ?? 'name';
  const aliased = query.aggregates?.[0]?.alias?.trim();
  return { xKey, yKey: aliased && aliased.length > 0 ? aliased : 'value' };
}

function Chart({ chartType, query, rows }: { chartType: ChartType; query: ReportQuery; rows: Row[] }) {
  const { xKey, yKey } = deriveKeys(query);
  const named = rows.map((r) => ({ name: String(r[xKey] ?? ''), value: Number(r[yKey] ?? 0) }));

  switch (chartType) {
    case 'line':
      return <LineChart data={rows} xKey={xKey} yKey={yKey} aria-label="Report preview" />;
    case 'bar':
      return <BarChart data={rows} xKey={xKey} yKey={yKey} aria-label="Report preview" />;
    case 'area':
      return <AreaChart data={rows} xKey={xKey} yKey={yKey} aria-label="Report preview" />;
    case 'pie':
      return <PieChart data={named} aria-label="Report preview" />;
    case 'donut':
      return <DonutChart data={named} aria-label="Report preview" />;
    case 'funnel':
      return <FunnelChart data={named} aria-label="Report preview" />;
    case 'heatmap':
      return (
        <HeatmapChart
          data={rows.map((r) => ({ label: String(r[xKey] ?? ''), value: Number(r[yKey] ?? 0) }))}
          aria-label="Report preview"
        />
      );
    case 'gauge':
      return (
        <GaugeChart value={Number(rows[0]?.[yKey] ?? 0)} label={yKey} aria-label="Report preview" />
      );
    case 'radar':
      return <RadarChart data={rows} keys={[yKey]} nameKey={xKey} aria-label="Report preview" />;
    case 'table':
    default:
      return <TableChart data={rows} aria-label="Report preview" />;
  }
}

interface Props {
  chartType: ChartType;
  query: ReportQuery;
  run: ReportRun | null;
  isLoading: boolean;
  error: string | null;
  onRun: () => void;
}

export function ReportPreview({ chartType, query, run, isLoading, error, onRun }: Props) {
  const rows: Row[] = run?.result ?? [];
  const runError = run?.status === 'error' ? (run.error ?? 'Query failed') : null;
  const combinedError = error ?? runError;
  const hasRun = run !== null || isLoading || combinedError !== null;
  const empty = run !== null && !isLoading && !combinedError && rows.length === 0;

  return (
    <ChartContainer
      title="Live preview"
      subtitle={run && !combinedError ? `${rows.length} row${rows.length === 1 ? '' : 's'}` : undefined}
      loading={isLoading}
      error={combinedError}
      empty={empty}
      emptyMessage="No rows match this query yet."
      onRefresh={onRun}
      aria-label="Report preview"
    >
      {!hasRun ? (
        <p className="py-8 text-center text-sm text-[var(--fg-tertiary)]">
          Build your query, then run a preview to see results here.
        </p>
      ) : (
        <div className="space-y-4">
          {chartType !== 'table' && rows.length > 0 && (
            <PreviewErrorBoundary>
              <Chart chartType={chartType} query={query} rows={rows} />
            </PreviewErrorBoundary>
          )}
          {rows.length > 0 && <TableChart data={rows} aria-label="Report preview rows" />}
        </div>
      )}
    </ChartContainer>
  );
}
