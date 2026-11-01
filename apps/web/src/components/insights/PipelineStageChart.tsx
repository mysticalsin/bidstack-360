import { useReducedMotion } from 'framer-motion';

import { FunnelChart } from '@/components/charts/funnel-chart';
import { useInsightOpportunities } from '@/hooks/useInsightsData';

import { InsightFrame } from './InsightFrame';
import {
  formatInsightAmount,
  insightErrorText,
  insightSeriesColor,
  leadStageIndex,
  pipelineIsEmpty,
  shapePipelineByStage,
} from './shapeInsights';

export function PipelineStageChart() {
  const reduced = useReducedMotion();
  const query = useInsightOpportunities();
  const visual = query.data ? shapePipelineByStage(query.data.items) : null;
  const status = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : !visual || pipelineIsEmpty(visual)
        ? 'empty'
        : 'ready';

  const currencyNote = visual?.currency
    ? `Amounts are in ${visual.currency}.`
    : 'Amounts use the API value. Currency is unspecified because this endpoint does not send one.';

  return (
    <InsightFrame
      title="Pipeline by stage"
      caption={`Width is the opportunity count. ${currencyNote}`}
      status={status}
      errorMessage={insightErrorText(query.error)}
      onRetry={() => void query.refetch()}
      emptyTitle="No opportunities in the pipeline"
      emptyMessage="Stages appear here once opportunities exist. Nothing is filled in ahead of that."
      emptyIcon="pipeline"
    >
      {visual && status === 'ready' ? (
        <div className="flex flex-col gap-4 px-4 py-4">
          {!query.data?.complete ? (
            <p className="text-xs text-[var(--fg-tertiary)]">
              Showing the first {visual.opportunityCount} opportunities returned before the page
              cap. Later pages are not in this chart.
            </p>
          ) : null}
          <div aria-hidden="true">
            <FunnelChart
              data={visual.stages.map((stage, index) => ({
                label: stage.label,
                value: stage.count,
                displayValue: `${stage.count} · ${formatInsightAmount(stage.amount, visual.currency)}`,
                color: insightSeriesColor(index, leadStageIndex(visual.stages)),
              }))}
              orientation="vertical"
              edges="straight"
              layers={1}
              showPercentage={false}
              gap={8}
              staggerDelay={reduced ? 0 : 0.08}
              enterTransition={reduced ? { duration: 0 } : undefined}
              style={{ height: Math.max(192, visual.stages.length * 72) }}
            />
          </div>
          <CountTable
            caption="Opportunity count and value by stage"
            headers={['Stage', 'Opportunities', 'Amount']}
            rows={visual.stages.map((stage) => [
              stage.label,
              String(stage.count),
              formatInsightAmount(stage.amount, visual.currency),
            ])}
          />
        </div>
      ) : null}
    </InsightFrame>
  );
}

export function CountTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: [string, string, string];
  rows: Array<[string, string, string]>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
      <table className="w-full text-left text-xs text-[var(--fg-primary)]">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]">
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="px-2 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-[var(--border-subtle)]">
              <th scope="row" className="px-2 py-2 font-medium">
                {row[0]}
              </th>
              <td className="px-2 py-2 tabular-nums">{row[1]}</td>
              <td className="px-2 py-2 tabular-nums">{row[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
