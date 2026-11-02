import { useReducedMotion } from 'framer-motion';

import { PieChart } from '@/components/charts/pie-chart';
import { PieSlice } from '@/components/charts/pie-slice';
import { CHART_COLORS } from '@/components/charts/chartTokens';
import { useInsightCompanies } from '@/hooks/useInsightsData';

import { InsightFrame } from './InsightFrame';
import { CountTable } from './PipelineStageChart';
import {
  accountDistributionIsEmpty,
  insightErrorText,
  shapeAccountDistribution,
} from './shapeInsights';

export function AccountDistributionChart() {
  const reduced = useReducedMotion();
  const query = useInsightCompanies();
  const slices = query.data ? shapeAccountDistribution(query.data.items) : null;
  const status = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : !slices || accountDistributionIsEmpty(slices)
        ? 'empty'
        : 'ready';

  return (
    <InsightFrame
      title="Account distribution"
      caption="Slice size is the number of companies in each industry. Blank industry is labeled Unspecified."
      status={status}
      errorMessage={insightErrorText(query.error)}
      onRetry={() => void query.refetch()}
      emptyTitle="No companies yet"
      emptyMessage="Industry counts appear after companies are on file."
      emptyIcon="building"
    >
      {slices && query.data && status === 'ready' ? (
        <div className="flex flex-col gap-4 px-4 py-4">
          {!query.data.complete ? (
            <p className="text-xs text-[var(--fg-tertiary)]">
              Showing the first {query.data.items.length} companies returned before the page cap.
            </p>
          ) : null}
          <div className="mx-auto w-full max-w-[280px]" aria-hidden="true">
            <PieChart
              data={slices.map((slice, index) => ({
                label: slice.label,
                value: slice.count,
                color: CHART_COLORS[index % CHART_COLORS.length],
              }))}
              padAngle={0.02}
              hoverOffset={6}
            >
              {slices.map((slice, index) => (
                <PieSlice
                  key={slice.key}
                  index={index}
                  hoverEffect="none"
                  animate={reduced !== true}
                />
              ))}
            </PieChart>
          </div>
          <CountTable
            caption="Company count by industry"
            headers={['Industry', 'Companies', 'Share of loaded companies']}
            rows={slices.map((slice) => [
              slice.label,
              String(slice.count),
              shareLabel(slice.count, query.data.items.length),
            ])}
          />
        </div>
      ) : null}
    </InsightFrame>
  );
}

function shareLabel(count: number, total: number): string {
  if (total <= 0) return '—';
  return new Intl.NumberFormat('en', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(count / total);
}
