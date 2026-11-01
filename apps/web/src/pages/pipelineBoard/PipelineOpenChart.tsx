import { useTranslation } from 'react-i18next';

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
  const open = openPipelineStages(stages);
  if (open.length === 0) return null;
  const maxValue = Math.max(1, ...open.map((stage) => stage.valueSum));
  const label = open
    .map(
      (stage) =>
        `${stageName(stage.stage)}, ${formatUnspecifiedCompact(stage.valueSum)}, ${stage.count}`,
    )
    .join('. ');

  return (
    <ul className="flex flex-col gap-3" aria-label={label}>
      {open.map((stage) => {
        const width = Math.max(stage.valueSum > 0 ? 4 : 0, (stage.valueSum / maxValue) * 100);
        return (
          <li
            key={stage.stage}
            className="grid grid-cols-[11.5rem_minmax(0,1fr)_auto] items-center gap-3"
          >
            <span className="text-sm text-[var(--fg-secondary)]">{stageName(stage.stage)}</span>
            <span className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <span
                className="block h-full rounded-full bg-[var(--brand-primary)]"
                style={{ width: `${width}%` }}
              />
            </span>
            <span className="text-xs tabular-nums text-[var(--fg-secondary)]">
              {formatUnspecifiedCompact(stage.valueSum)}
              <span className="text-[var(--fg-tertiary)]">
                {' · '}
                {stage.count === 1
                  ? t('pipeline.stageDealCount_one', '{{count}} deal', { count: stage.count })
                  : t('pipeline.stageDealCount_other', '{{count}} deals', { count: stage.count })}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
