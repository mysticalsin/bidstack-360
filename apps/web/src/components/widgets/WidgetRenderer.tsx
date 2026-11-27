// WidgetRenderer — given a DashboardWidget config, queries the report endpoint
// and renders the correct chart component. Wraps in ChartContainer for
// loading/error/empty/actions states.
//
// An internal ErrorBoundary catches chart render failures so one bad widget
// cannot crash the entire dashboard.

import { Component, type ReactNode, useCallback } from 'react';
import { Download, Settings, Copy, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { csvCell } from '@/lib/csv';
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
  ScatterChart,
  TableChart,
} from '@/components/charts/charts';
import { KpiCard } from '@/components/charts/KpiCard';
import type { DashboardWidget } from '@/hooks/useDashboards';
import { useReportRun, useRunReport, type ReportRun } from '@/hooks/useAnalyticsReports';
import { usePipelineReport } from '@/hooks/usePipelineReport';

import { builtinWidgetRows, resolveBuiltinSource } from './builtinWidgetData';

// ── Error Boundary ────────────────────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class ChartErrorBoundary extends Component<
  { children: ReactNode; t: TFunction },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; t: TFunction }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : '',
    };
  }

  override render() {
    const { t } = this.props;
    if (this.state.hasError) {
      const message =
        this.state.message || t('widgetRenderer.chartRenderError', 'Chart render error');
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center py-10 text-center"
        >
          <span className="text-2xl mb-2" aria-hidden>⚠</span>
          <p className="text-xs text-[var(--danger)]">{message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="mt-3 text-xs text-[var(--brand-primary)] underline min-h-[44px] px-3"
          >
            {t('widgetRenderer.retry', 'Retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Inner chart renderer ──────────────────────────────────────────────────────

type DataRow = Record<string, unknown>;

function ChartBody({
  widget,
  data,
}: {
  widget: DashboardWidget;
  data: DataRow[];
}) {
  const cfg = widget.config as {
    xKey?: string;
    yKey?: string | string[];
    keys?: string[];
    nameKey?: string;
    stacked?: boolean;
    gaugeValue?: number;
    gaugeLabel?: string;
    columns?: number;
  };

  const xKey = cfg.xKey ?? 'name';
  const yKey = cfg.yKey ?? 'value';

  switch (widget.type) {
    case 'kpi': {
      const rows = data as { value?: number; current?: number }[];
      const val = Number(rows[0]?.value ?? rows[0]?.current ?? 0);
      return (
        <KpiCard
          title={widget.title}
          value={val}
          aria-label={widget.title}
        />
      );
    }
    case 'line':
      return (
        <LineChart
          data={data}
          xKey={xKey}
          yKey={yKey}
          aria-label={widget.title}
        />
      );
    case 'bar':
      return (
        <BarChart
          data={data}
          xKey={xKey}
          yKey={yKey}
          stacked={cfg.stacked}
          aria-label={widget.title}
        />
      );
    case 'area':
      return (
        <AreaChart
          data={data}
          xKey={xKey}
          yKey={yKey}
          aria-label={widget.title}
        />
      );
    case 'pie':
      return (
        <PieChart
          data={data as { name: string; value: number }[]}
          aria-label={widget.title}
        />
      );
    case 'donut':
      return (
        <DonutChart
          data={data as { name: string; value: number }[]}
          aria-label={widget.title}
        />
      );
    case 'funnel':
      return (
        <FunnelChart
          data={data as { name: string; value: number }[]}
          aria-label={widget.title}
        />
      );
    case 'gauge':
      return (
        <GaugeChart
          value={cfg.gaugeValue ?? 0}
          label={cfg.gaugeLabel ?? widget.title}
          aria-label={widget.title}
        />
      );
    case 'heatmap':
      return (
        <HeatmapChart
          data={data as { label: string; value: number }[]}
          columns={cfg.columns}
          aria-label={widget.title}
        />
      );
    case 'scatter':
      return (
        <ScatterChart
          data={data as { x: number; y: number }[]}
          aria-label={widget.title}
        />
      );
    case 'radar':
      return (
        <RadarChart
          data={data}
          keys={cfg.keys ?? [String(yKey)]}
          nameKey={cfg.nameKey ?? xKey}
          aria-label={widget.title}
        />
      );
    case 'table':
    default:
      return <TableChart data={data} aria-label={widget.title} />;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props {
  widget: DashboardWidget;
  onConfigure?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

export function WidgetRenderer({ widget, onConfigure, onDuplicate, onDelete }: Props) {
  const { t } = useTranslation('crm');
  const qc = useQueryClient();
  const runMutation = useRunReport();

  // A saved report still polls its latest run. The seeded pipeline cards have
  // no reportId; they read the live pipeline snapshot instead of an empty run.
  const source = resolveBuiltinSource(widget);
  const pipeline = usePipelineReport();
  const { data: run, isLoading, error } = useReportRun(
    widget.reportId ?? '',
    (widget.config as { latestRunId?: string }).latestRunId ?? '',
  );

  const reportRows: DataRow[] = (run as ReportRun | undefined)?.result ?? [];
  const data: DataRow[] =
    source && pipeline.data ? builtinWidgetRows(source, pipeline.data) : source ? [] : reportRows;
  const loading = source ? pipeline.isLoading && !pipeline.data : isLoading;
  const failure = source ? pipeline.error : error;
  const empty = !loading && !(failure instanceof Error) && data.length === 0;

  const refetchPipeline = pipeline.refetch;
  const handleRefresh = useCallback(async () => {
    if (source) {
      await refetchPipeline();
      return;
    }
    if (!widget.reportId) return;
    await runMutation.mutateAsync({ id: widget.reportId });
    // Invalidate the widget so consumers re-fetch the new runId
    qc.invalidateQueries({ queryKey: ['dashboards', 'widgets', widget.dashboardId] });
  }, [source, refetchPipeline, widget.reportId, widget.dashboardId, runMutation, qc]);

  const handleExportCsv = useCallback(() => {
    const rows = data;
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]!);
    const lines = [
      headers.map((h) => csvCell(h)).join(','),
      ...rows.map((r) =>
        headers
          .map((h) => {
            // csvCell neutralizes formula-injection (=,+,-,@,TAB,CR) before quoting.
            const v = csvCell(String(r[h] ?? ''));
            return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
          })
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${widget.title}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, widget.title]);

  const actions = [
    ...(onConfigure
      ? [{ label: t('widgetRenderer.configure', 'Configure'), icon: <Settings size={14} />, onClick: onConfigure }]
      : []),
    ...(onDuplicate
      ? [{ label: t('widgetRenderer.duplicate', 'Duplicate'), icon: <Copy size={14} />, onClick: onDuplicate }]
      : []),
    ...(data.length > 0
      ? [{ label: t('widgetRenderer.exportCsv', 'Export CSV'), icon: <Download size={14} />, onClick: handleExportCsv }]
      : []),
    ...(onDelete
      ? [{ label: t('widgetRenderer.delete', 'Delete'), icon: <Trash2 size={14} />, onClick: onDelete }]
      : []),
  ];

  return (
    <ChartContainer
      title={widget.type !== 'kpi' ? widget.title : undefined}
      loading={loading}
      error={failure instanceof Error ? failure.message : null}
      empty={empty}
      emptyMessage={
        source ? t('widgetRenderer.noOpenDeals', 'No open deals to chart.') : undefined
      }
      onRefresh={source || widget.reportId ? handleRefresh : undefined}
      actions={actions}
      aria-label={widget.title}
    >
      <ChartErrorBoundary t={t}>
        <ChartBody widget={widget} data={data} />
      </ChartErrorBoundary>
    </ChartContainer>
  );
}
