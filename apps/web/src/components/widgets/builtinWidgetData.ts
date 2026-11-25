// Built-in dashboard widgets that are not backed by a saved analytics report.
//
// The seeded Pre-sales Command Center ships two widgets (Weighted Pipeline,
// Pipeline by Stage) with no reportId. WidgetRenderer used to treat "no report
// run" as an empty series and show "No data available for this time period"
// even when GET /api/reports/pipeline had open deals. These helpers bind those
// widgets to that live pipeline snapshot instead.

import { formatStage } from '@/lib/format';

export type BuiltinWidgetSource = 'weighted-pipeline' | 'pipeline-by-stage';

export interface PipelineStageSnapshot {
  stage: string;
  count: number;
  valueSum: number;
}

export interface PipelineSnapshot {
  byStage: PipelineStageSnapshot[];
  weightedPipeline: number;
}

const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);

// Same order as the demo book. groupBy does not return stages in this order.
const OPEN_STAGE_ORDER = [
  's1_lead',
  's1_ongoing',
  's2_sent',
  's3_technical_iteration',
  's4_negotiation',
];

export function resolveBuiltinSource(widget: {
  title: string;
  reportId?: string | null;
  config: unknown;
}): BuiltinWidgetSource | null {
  // A saved report owns the series. Don't also overlay the pipeline snapshot.
  if (widget.reportId) return null;
  const configured = readSource(widget.config);
  if (configured) return configured;
  const title = widget.title.trim().toLowerCase();
  if (title === 'weighted pipeline') return 'weighted-pipeline';
  if (title === 'pipeline by stage') return 'pipeline-by-stage';
  return null;
}

export function builtinWidgetRows(
  source: BuiltinWidgetSource,
  report: PipelineSnapshot,
): Array<Record<string, unknown>> {
  if (source === 'weighted-pipeline') {
    // Always one row so a real zero (no open deals) renders as 0, not as
    // "no data for this period".
    return [{ value: report.weightedPipeline }];
  }
  return report.byStage
    .filter((row) => !CLOSED_STAGES.has(row.stage) && row.count > 0)
    .map((row) => ({ row, order: OPEN_STAGE_ORDER.indexOf(row.stage) }))
    .sort((a, b) => {
      const ao = a.order === -1 ? OPEN_STAGE_ORDER.length : a.order;
      const bo = b.order === -1 ? OPEN_STAGE_ORDER.length : b.order;
      if (ao !== bo) return ao - bo;
      return a.row.stage.localeCompare(b.row.stage);
    })
    .map(({ row }) => ({
      name: formatStage(row.stage),
      value: row.valueSum,
    }));
}

function readSource(config: unknown): BuiltinWidgetSource | null {
  if (!config || typeof config !== 'object') return null;
  const source = (config as { source?: unknown }).source;
  if (source === 'weighted-pipeline' || source === 'pipeline-by-stage') return source;
  return null;
}
