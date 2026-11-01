/**
 * dashboard/widgets/PipelineByStageMini.tsx — animated horizontal bar chart
 * showing pipeline value broken down by stage.
 *
 * WHY a separate module: the stage-bar loop (~52 source lines) is distinct
 * presentational logic from the PipelineCard sparkline. Separating them lets
 * each be restyled or swapped independently.
 */
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/components/ui/GlassCard';
import { springSoft } from '@/lib/motion';
import { formatUnspecifiedAmount, UNSPECIFIED_CURRENCY_BASIS } from '../unspecified-currency';

import { stageColor, stageLabel } from './dashboard-types';

const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);

/** Closed won and lost are outcomes. The pipeline chart is the open book. */
export function openPipelineStages<T extends { stage: string }>(stages: readonly T[]): T[] {
  return stages.filter((stage) => !CLOSED_STAGES.has(stage.stage));
}

export interface PipelineStagePoint {
  stage: string;
  count: number;
  valueSum: number;
}

/**
 * Headline numbers for the whole recorded book.
 * Open value excludes closed won and lost. Win rate is a count ratio.
 */
export function pipelineHeadline(byStage: readonly PipelineStagePoint[]): {
  openValue: number;
  openCount: number;
  wonValue: number;
  lostValue: number;
  winRate: number | null;
} {
  const open = openPipelineStages(byStage);
  const won = byStage.find((stage) => stage.stage === 'closed_won');
  const lost = byStage.find((stage) => stage.stage === 'closed_lost');
  const closed = (won?.count ?? 0) + (lost?.count ?? 0);
  return {
    openValue: open.reduce((sum, stage) => sum + stage.valueSum, 0),
    openCount: open.reduce((sum, stage) => sum + stage.count, 0),
    wonValue: won?.valueSum ?? 0,
    lostValue: lost?.valueSum ?? 0,
    winRate: closed > 0 ? (won?.count ?? 0) / closed : null,
  };
}

// ─── PipelineByStageMini ─────────────────────────────────────────────────────

export function PipelineByStageMini({
  report,
  reduced,
}: {
  report: { byStage: Array<{ stage: string; count: number; valueSum: number }> } | undefined;
  reduced: boolean | null;
}) {
  const { t } = useTranslation('crm');
  if (!report || report.byStage.length === 0) return null;
  const stages = openPipelineStages(report.byStage);
  const maxValue = Math.max(1, ...stages.map((s) => s.valueSum));

  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="px-1 pb-2 pt-1">
        <div className="text-sm text-[var(--fg-secondary)]">
          {t('pipelineByStageMini.heading', 'Pipeline by stage')}
        </div>
        <div className="mt-1 text-xs text-[var(--fg-tertiary)]">{UNSPECIFIED_CURRENCY_BASIS}</div>
        <div className="mt-1 text-xs text-[var(--fg-tertiary)]">
          {t(
            'pipelineByStageMini.openCaption',
            'Open stages only. Closed won and lost stay in the win rate.',
          )}
        </div>
      </div>
      {stages.length === 0 ? (
        <p className="px-1 pb-2 text-xs text-[var(--fg-secondary)]">
          {t('pipelineByStageMini.emptyOpen', 'No open pipeline.')}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {stages.map((s, i) => (
          <motion.div
            key={s.stage}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...springSoft, delay: reduced ? 0 : i * 0.045 }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[var(--fg-secondary)] capitalize">
                {stageLabel(s.stage)}
              </span>
              <span className="text-xs font-semibold tabular-nums text-[var(--fg-primary)]">
                {t('pipelineByStageMini.dealCount', '{{count}} deals', { count: s.count })} ·{' '}
                {formatUnspecifiedAmount(s.valueSum)}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--surface-sunken)] overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: stageColor(s.stage) }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(4, (s.valueSum / maxValue) * 100)}%` }}
                transition={{ ...springSoft, delay: reduced ? 0 : i * 0.045 + 0.08 }}
              />
            </div>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  );
}
