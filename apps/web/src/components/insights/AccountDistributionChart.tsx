import { useReducedMotion } from 'framer-motion';

import { PieChart } from '@/components/charts/pie-chart';
import { PieSlice } from '@/components/charts/pie-slice';
import { CHART_COLORS } from '@/components/charts/chartTokens';
import { useInsightCompanies } from '@/hooks/useInsightsData';

import { accountDistributionPhase } from './account-distribution-read';
import { InsightFrame } from './InsightFrame';
import { CountTable } from './PipelineStageChart';
import { accountDistributionIsEmpty, shapeAccountDistribution } from './shapeInsights';

export function AccountDistributionChart() {
  const reduced = useReducedMotion();
  const query = useInsightCompanies();
  const phase = accountDistributionPhase({
    data: query.data,
    isError: query.isError,
    status: query.status,
  });

  if (phase === 'unread') {
    return (
      <p className="text-xs text-[var(--fg-secondary)]">
        Checking account distribution. The companies have not arrived.
      </p>
    );
  }

  if (phase === 'failed') {
    return (
      <p role="alert" className="text-xs text-[var(--danger)]">
        Could not load account distribution.
      </p>
    );
  }

  const loaded = query.data ?? null;
  const items = loaded?.items ?? [];
  const slices = shapeAccountDistribution(items);
  const empty = accountDistributionIsEmpty(slices);

  return (
    <InsightFrame
      title="Account distribution"
      caption="Slice size is the number of companies in each industry. Blank industry is labeled Unspecified."
      status={empty ? 'empty' : 'ready'}
      emptyTitle="No companies yet"
      emptyMessage="Industry counts appear after companies are on file."
      emptyIcon="building"
    >
      {!empty && loaded ? (
        <div className="flex flex-col gap-4 px-4 py-4">
          {!loaded.complete ? (
            <p className="text-xs text-[var(--fg-tertiary)]">
              Showing the first {loaded.items.length} companies returned before the page cap.
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
              shareLabel(slice.count, loaded.items.length),
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
