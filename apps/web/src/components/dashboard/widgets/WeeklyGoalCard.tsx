/**
 * dashboard/widgets/WeeklyGoalCard.tsx — animated progress bar tracking the
 * weekly pipeline value target in the OrgDashboard sidebar.
 *
 * WHY a separate module: the progress calculation and compact goal display
 * are self-contained and will move to a configurable Goals feature.
 */
import { motion } from 'framer-motion';

import { GlassCard } from '@/components/ui/GlassCard';
import { springSoft } from '@/lib/motion';
import { formatMoney } from '@/lib/format';

// ─── WeeklyGoalCard ───────────────────────────────────────────────────────────

export function WeeklyGoalCard({
  pipelineValue,
  targetValue,
  currency,
}: {
  pipelineValue: number;
  targetValue: number;
  currency: string;
}) {
  const progress = Math.min(100, (pipelineValue / targetValue) * 100);
  const remaining = Math.max(0, targetValue - pipelineValue);

  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] px-1 pt-1 pb-2">
        Weekly goal
      </div>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="text-xl font-bold tabular-nums text-[var(--fg-primary)]">
          {formatMoney(pipelineValue, currency)}
        </span>
        <span className="text-xs text-[var(--fg-secondary)]">
          of {formatMoney(targetValue, currency)}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-[var(--surface-sunken)] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            background:
              progress >= 100
                ? 'var(--success)'
                : progress >= 50
                  ? 'var(--brand-primary)'
                  : 'var(--warning)',
          }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ ...springSoft, delay: 0.2 }}
        />
      </div>
      <div className="mt-2 text-xs text-[var(--fg-secondary)]">
        {progress >= 100 ? (
          <span style={{ color: 'var(--success)' }}>🎉 Target reached!</span>
        ) : (
          <>{formatMoney(remaining, currency)} remaining</>
        )}
      </div>
    </GlassCard>
  );
}
