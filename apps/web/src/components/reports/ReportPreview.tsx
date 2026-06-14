// ReportPreview — live result pane for the report builder. Renders the rows
// returned by a preview/saved run as the chosen chart type, with a robust
// TableChart fallback and an error boundary so a chart-shape mismatch can't
// crash the builder. xKey/yKey are DERIVED from the query (the engine's
// contract: group keys aliased by field, a lone aggregate aliased 'value'),
// never free-typed.

import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
  { children: ReactNode; fallbackMessage: string },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode; fallbackMessage: string }) {
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
          {this.props.fallbackMessage}
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
  const { t } = useTranslation('reports');
  const { xKey, yKey } = deriveKeys(query);
  const named = rows.map((r) => ({ name: String(r[xKey] ?? ''), value: Number(r[yKey] ?? 0) }));
  const ariaLabel = t('reportPreview.chartAriaLabel', 'Report preview');

  switch (chartType) {
    case 'line':
      return <LineChart data={rows} xKey={xKey} yKey={yKey} aria-label={ariaLabel} />;
    case 'bar':
      return <BarChart data={rows} xKey={xKey} yKey={yKey} aria-label={ariaLabel} />;
    case 'area':
      return <AreaChart data={rows} xKey={xKey} yKey={yKey} aria-label={ariaLabel} />;
    case 'pie':
      return <PieChart data={named} aria-label={ariaLabel} />;
    case 'donut':
      return <DonutChart data={named} aria-label={ariaLabel} />;
    case 'funnel':
      return <FunnelChart data={named} aria-label={ariaLabel} />;
    case 'heatmap':
      return (
        <HeatmapChart
          data={rows.map((r) => ({ label: String(r[xKey] ?? ''), value: Number(r[yKey] ?? 0) }))}
          aria-label={ariaLabel}
        />
      );
    case 'gauge':
      return (
        <GaugeChart value={Number(rows[0]?.[yKey] ?? 0)} label={yKey} aria-label={ariaLabel} />
      );
    case 'radar':
      return <RadarChart data={rows} keys={[yKey]} nameKey={xKey} aria-label={ariaLabel} />;
    case 'table':
    default:
      return <TableChart data={rows} aria-label={ariaLabel} />;
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
  const { t } = useTranslation('reports');
  const rows: Row[] = run?.result ?? [];
  const runError = run?.status === 'error' ? (run.error ?? t('reportPreview.queryFailed', 'Query failed')) : null;
  const combinedError = error ?? runError;
  const hasRun = run !== null || isLoading || combinedError !== null;
  const empty = run !== null && !isLoading && !combinedError && rows.length === 0;
  const rowCount = rows.length;
  const subtitle =
    run && !combinedError
      ? rowCount === 1
        ? t('reportPreview.rowCountOne', '{{count}} row', { count: rowCount })
        : t('reportPreview.rowCountOther', '{{count}} rows', { count: rowCount })
      : undefined;

  return (
    <ChartContainer
      title={t('reportPreview.title', 'Live preview')}
      subtitle={subtitle}
      loading={isLoading}
      error={combinedError}
      empty={empty}
      emptyMessage={t('reportPreview.emptyMessage', 'No rows match this query yet.')}
      onRefresh={onRun}
      aria-label={t('reportPreview.chartAriaLabel', 'Report preview')}
    >
      {!hasRun ? (
        <p className="py-8 text-center text-sm text-[var(--fg-tertiary)]">
          {t('reportPreview.runPrompt', 'Build your query, then run a preview to see results here.')}
        </p>
      ) : (
        <div className="space-y-4">
          {chartType !== 'table' && rows.length > 0 && (
            <PreviewErrorBoundary
              fallbackMessage={t(
                'reportPreview.chartShapeMismatch',
                "This chart type doesn't fit the current query shape. The table below shows the raw rows.",
              )}
            >
              <Chart chartType={chartType} query={query} rows={rows} />
            </PreviewErrorBoundary>
          )}
          {rows.length > 0 && (
            <TableChart data={rows} aria-label={t('reportPreview.rowsAriaLabel', 'Report preview rows')} />
          )}
        </div>
      )}
    </ChartContainer>
  );
}
