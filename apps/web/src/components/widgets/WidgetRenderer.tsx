// WidgetRenderer — given a DashboardWidget config, queries the report endpoint
// and renders the correct chart component. Wraps in ChartContainer for
// loading/error/empty/actions states.
//
// An internal ErrorBoundary catches chart render failures so one bad widget
// cannot crash the entire dashboard.

import { Component, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Download, Settings, Copy, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { csvCell } from '@/lib/csv';
import { formatMoney } from '@/lib/format';
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
import { formatKpiValue } from '@/components/charts/kpi-value';
import type { DashboardWidget } from '@/hooks/useDashboards';
import { useHasPermission } from '@/hooks/useCapabilities';
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

const MICROS_PER_UNIT = 1_000_000n;

/** Currency widgets carry integer micros. Split before Number() so a large sum stays exact. */
function unitsFromMicros(micros: number): number {
  if (!Number.isFinite(micros)) return micros;
  const value = BigInt(Math.trunc(micros));
  return Number(value / MICROS_PER_UNIT) + Number(value % MICROS_PER_UNIT) / 1_000_000;
}

function kpiPresentation(format: string | undefined, raw: number): { value: number; format: (n: number) => string } {
  if (format === 'currency') return { value: unitsFromMicros(raw), format: (n) => formatMoney(n) };
  if (format === 'percent') return { value: raw, format: (n) => `${formatKpiValue(n)}%` };
  return { value: raw, format: formatKpiValue };
}

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
    format?: string;
  };

  const xKey = cfg.xKey ?? 'name';
  const yKey = cfg.yKey ?? 'value';

  switch (widget.type) {
    case 'kpi': {
      const rows = data as { value?: number; current?: number }[];
      const raw = Number(rows[0]?.value ?? rows[0]?.current ?? 0);
      const presented = kpiPresentation(cfg.format, raw);
      return (
        <KpiCard
          title={widget.title}
          value={presented.value}
          format={presented.format}
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
  const startedFor = useRef<string | null>(null);
  const [autoRunError, setAutoRunError] = useState<string | null>(null);
  const latestRunId = (widget.config as { latestRunId?: string }).latestRunId ?? '';
  const canRunReport = useHasPermission('reports:write');

  // A saved widget has no stored run until someone who may write reports
  // executes it. Viewing must not persist a run or an audit row.
  useEffect(() => {
    if (!canRunReport || !widget.reportId || latestRunId) return;
    if (startedFor.current === widget.reportId) return;
    startedFor.current = widget.reportId;
    void runMutation.mutateAsync({ id: widget.reportId }).then(
      () => {
        void qc.invalidateQueries({ queryKey: ['dashboards', 'widgets', widget.dashboardId] });
      },
      (err: unknown) => {
        setAutoRunError(
          err instanceof Error && err.message ? err.message : 'Could not run this report.',
        );
      },
    );
  }, [canRunReport, widget.reportId, latestRunId, widget.dashboardId, qc, runMutation]);

  const { data: run, isLoading, error } = useReportRun(widget.reportId ?? '', latestRunId);

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
  const needsReport = !widget.reportId;
  const runError = error instanceof Error ? error.message : autoRunError;
  const waitingForRun = canRunReport && Boolean(widget.reportId) && !latestRunId && !runError;
  const empty = !needsReport && !isLoading && !runError && data.length === 0;

  return (
    <ChartContainer
      title={widget.type !== 'kpi' ? widget.title : undefined}
      loading={isLoading || waitingForRun}
      error={runError}
      empty={needsReport || empty}
      emptyMessage={
        needsReport
          ? t('widgetRenderer.needsReport', 'This widget needs a report.')
          : undefined
      }
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
