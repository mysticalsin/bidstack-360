import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarYAxis } from '@/components/charts/bar-y-axis';
import { formatUnspecifiedCompact } from '@/components/dashboard/unspecified-currency';
import {
  openPipelineStages,
  type PipelineStagePoint,
} from '@/components/dashboard/widgets/PipelineByStageMini';

function stageName(stage: string): string {
  return stage
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Open stages from the whole recorded pipeline. Closed outcomes stay off the bars. */
export function PipelineOpenChart({ stages }: { stages: readonly PipelineStagePoint[] }) {
  const { t } = useTranslation('crm');
  const reducedMotion = useReducedMotion();
  const open = openPipelineStages(stages);
  if (open.length === 0) return null;
  const rows = open.map((stage) => ({
    stage: stageName(stage.stage),
    value: stage.valueSum,
    count: stage.count,
  }));
  const label = rows
    .map(
      (stage) =>
        `${stage.stage}, ${formatUnspecifiedCompact(stage.value)}, ${stage.count}`,
    )
    .join('. ');

  return (
    <div
      className="grid items-stretch gap-3"
      role="img"
      aria-label={label}
      style={{
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        height: Math.max(168, rows.length * 44),
      }}
    >
      <BarChart
        data={rows}
        xDataKey="stage"
        orientation="horizontal"
        aspectRatio="auto"
        className="h-full"
        animationDuration={reducedMotion ? 0 : 450}
        enterTransition={reducedMotion ? { duration: 0 } : { duration: 0.45, ease: [0.2, 0, 0, 1] }}
        margin={{ top: 0, right: 8, bottom: 0, left: 176 }}
        barGap={0.4}
      >
        <Bar
          dataKey="value"
          fill="var(--brand-primary)"
          lineCap="butt"
          fadedOpacity={1}
          animate={!reducedMotion}
        />
        <BarYAxis labelWidth={160} />
      </BarChart>
      <ul
        className="m-0 list-none p-0"
        style={{ display: 'grid', gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))` }}
      >
        {rows.map((stage) => (
          <li
            key={stage.stage}
            className="flex items-center justify-end text-xs tabular-nums text-[var(--fg-secondary)]"
          >
            {formatUnspecifiedCompact(stage.value)}
            <span className="text-[var(--fg-tertiary)]">
              {' · '}
              {stage.count === 1
                ? t('pipeline.stageDealCount_one', '{{count}} deal', { count: stage.count })
                : t('pipeline.stageDealCount_other', '{{count}} deals', { count: stage.count })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
