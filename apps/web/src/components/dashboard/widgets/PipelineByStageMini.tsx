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
import { formatUnspecifiedAmount } from '../unspecified-currency';

import { stageColor, stageLabel } from './dashboard-types';

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
  const maxValue = Math.max(1, ...report.byStage.map((s) => s.valueSum));

  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="px-1 pb-2 pt-1 text-xs font-medium text-[var(--fg-tertiary)]">
        {t('pipelineByStageMini.heading', 'Pipeline by stage')}
      </div>
      <div className="flex flex-col gap-2">
        {report.byStage.map((s, i) => (
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
                {s.count} · {formatUnspecifiedAmount(s.valueSum)}
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
