import { motion, useReducedMotion } from 'framer-motion';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft } from '@/lib/motion';
import type { TerritoryRevenueRow } from '@bidstack/shared';

interface Props {
  territories: TerritoryRevenueRow[];
  isLoading: boolean;
}

export function TerritoryRevenueCard({ territories, isLoading }: Props) {
  const { formatMoneyMicros } = useFormatMoney();
  const reducedMotion = useReducedMotion();
  const maxValue = territories.reduce(
    (max, t) => Math.max(max, t.revenueMicros + t.pipelineMicros),
    1,
  );

  return (
    <Card>
      <SectionHeader title="Territory Revenue" />
      <div className="px-5 pb-5">
        {isLoading ? (
          <LoadingSkeleton rows={5} />
        ) : territories.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {territories.map((territory, index) => {
              const total = territory.revenueMicros + territory.pipelineMicros;
              const pct = maxValue > 0 ? (total / maxValue) * 100 : 0;
              const revPct = total > 0 ? (territory.revenueMicros / total) * 100 : 0;
              return (
                <motion.div
                  key={territory.territoryName}
                  initial={reducedMotion ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
                >
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--fg-primary)]">
                      {territory.territoryName}
                    </span>
                    <span className="tabular-nums text-[var(--fg-secondary)]">
                      {territory.opportunityCount} opps · {formatMoneyMicros(total)}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                    <div className="flex h-full">
                      <motion.div
                        className="h-full rounded-l-full bg-emerald-500"
                        initial={reducedMotion ? false : { width: 0 }}
                        animate={{ width: `${pct * (revPct / 100)}%` }}
                        transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 + 0.1 }}
                      />
                      <motion.div
                        className="h-full rounded-r-full bg-blue-400"
                        initial={reducedMotion ? false : { width: 0 }}
                        animate={{ width: `${pct * ((100 - revPct) / 100)}%` }}
                        transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 + 0.15 }}
                      />
                    </div>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {formatMoneyMicros(territory.revenueMicros)} won
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                      {formatMoneyMicros(territory.pipelineMicros)} pipeline
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="mb-2 text-2xl opacity-40">🗺️</div>
      <p className="text-sm font-medium text-[var(--fg-secondary)]">No territory data</p>
      <p className="text-xs text-[var(--fg-tertiary)]">
        Assign territories to opportunities to see breakdown.
      </p>
    </div>
  );
}
