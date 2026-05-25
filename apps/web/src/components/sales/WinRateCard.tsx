import { motion, useReducedMotion } from 'framer-motion';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft } from '@/lib/motion';
import type { WinLossStats } from '@bidstack/shared';

interface Props {
  stats: WinLossStats | undefined;
  isLoading: boolean;
}

export function WinRateCard({ stats, isLoading }: Props) {
  const { formatMoneyMicros } = useFormatMoney();
  const reducedMotion = useReducedMotion();

  return (
    <Card>
      <SectionHeader title="Win / Loss" />
      <div className="px-5 pb-5">
        {isLoading || !stats ? (
          <LoadingSkeleton rows={3} />
        ) : stats.wonCount + stats.lostCount === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-5">
            {/* Donut-like visual using conic-gradient */}
            <div className="flex items-center gap-5">
              <div className="relative h-24 w-24 shrink-0">
                <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="var(--surface-elevated)"
                    strokeWidth="4"
                  />
                  {stats.wonCount + stats.lostCount > 0 && (
                    <motion.circle
                      cx="18"
                      cy="18"
                      r="15.9155"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="4"
                      strokeDasharray={`${stats.winRate} ${100 - stats.winRate}`}
                      initial={reducedMotion ? false : { strokeDasharray: '0 100' }}
                      animate={{
                        strokeDasharray: `${stats.winRate} ${100 - stats.winRate}`,
                      }}
                      transition={{ ...springSoft, duration: 0.8 }}
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-bold text-[var(--fg-primary)]">
                    {stats.winRate.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-[var(--fg-tertiary)]">win rate</span>
                </div>
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-[var(--fg-secondary)]">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    Won
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-[var(--fg-primary)]">
                    {stats.wonCount} · {formatMoneyMicros(stats.wonRevenueMicros)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-[var(--fg-secondary)]">
                    <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
                    Lost
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-[var(--fg-primary)]">
                    {stats.lostCount} · {formatMoneyMicros(stats.lostRevenueMicros)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--fg-secondary)]">Total closed</span>
                  <span className="text-xs font-semibold tabular-nums text-[var(--fg-primary)]">
                    {stats.wonCount + stats.lostCount}
                  </span>
                </div>
              </div>
            </div>

            {/* Mini bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]">
              <motion.div
                className="h-full rounded-full bg-emerald-500"
                initial={reducedMotion ? false : { width: 0 }}
                animate={{ width: `${stats.winRate}%` }}
                transition={{ ...springSoft, duration: 0.8 }}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="mb-2 text-2xl opacity-40">⚖️</div>
      <p className="text-sm font-medium text-[var(--fg-secondary)]">No closed deals yet</p>
      <p className="text-xs text-[var(--fg-tertiary)]">
        Win/loss stats appear once opportunities are closed.
      </p>
    </div>
  );
}
