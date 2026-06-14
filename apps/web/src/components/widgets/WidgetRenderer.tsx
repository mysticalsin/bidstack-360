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

  // If the widget has a reportId, poll the latest run
  const { data: run, isLoading, error } = useReportRun(
    widget.reportId ?? '',
    (widget.config as { latestRunId?: string }).latestRunId ?? '',
  );

  const handleRefresh = useCallback(async () => {
    if (!widget.reportId) return;
    await runMutation.mutateAsync({ id: widget.reportId });
    // Invalidate the widget so consumers re-fetch the new runId
    qc.invalidateQueries({ queryKey: ['dashboards', 'widgets', widget.dashboardId] });
  }, [widget.reportId, widget.dashboardId, runMutation, qc]);

  const handleExportCsv = useCallback(() => {
    const rows: DataRow[] = (run as ReportRun | undefined)?.result ?? [];
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]!);
    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        headers
          .map((h) => {
            const v = String(r[h] ?? '');
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
  }, [run, widget.title]);

  const actions = [
    ...(onConfigure
      ? [{ label: t('widgetRenderer.configure', 'Configure'), icon: <Settings size={14} />, onClick: onConfigure }]
      : []),
    ...(onDuplicate
      ? [{ label: t('widgetRenderer.duplicate', 'Duplicate'), icon: <Copy size={14} />, onClick: onDuplicate }]
      : []),
    { label: t('widgetRenderer.exportCsv', 'Export CSV'), icon: <Download size={14} />, onClick: handleExportCsv },
    ...(onDelete
      ? [{ label: t('widgetRenderer.delete', 'Delete'), icon: <Trash2 size={14} />, onClick: onDelete }]
      : []),
  ];

  const data: DataRow[] = (run as ReportRun | undefined)?.result ?? [];
  const empty = !isLoading && !error && data.length === 0;

  return (
    <ChartContainer
      title={widget.type !== 'kpi' ? widget.title : undefined}
      loading={isLoading}
      error={error instanceof Error ? error.message : null}
      empty={empty}
      onRefresh={widget.reportId ? handleRefresh : undefined}
      actions={actions}
      aria-label={widget.title}
    >
      <ChartErrorBoundary t={t}>
        <ChartBody widget={widget} data={data} />
      </ChartErrorBoundary>
    </ChartContainer>
  );
}
