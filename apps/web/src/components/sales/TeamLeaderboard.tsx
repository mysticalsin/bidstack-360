import { motion, useReducedMotion } from 'framer-motion';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft } from '@/lib/motion';
import type { TeamPerformanceRow } from '@bidstack/shared';

interface Props {
  members: TeamPerformanceRow[];
  isLoading: boolean;
}

export function TeamLeaderboard({ members, isLoading }: Props) {
  const { formatMoneyMicros } = useFormatMoney();
  const reducedMotion = useReducedMotion();
  const maxRevenue = members.reduce((max, m) => Math.max(max, m.revenueMicros), 1);

  return (
    <Card>
      <SectionHeader title="Team Leaderboard" />
      <div className="px-5 pb-5">
        {isLoading ? (
          <LoadingSkeleton rows={5} />
        ) : members.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {members.map((member, index) => {
              const pct = maxRevenue > 0 ? (member.revenueMicros / maxRevenue) * 100 : 0;
              const totalDeals = member.wonCount + member.lostCount + member.openCount;
              return (
                <motion.div
                  key={member.name}
                  initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-[var(--fg-primary)]">
                          {member.name}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-[var(--fg-tertiary)]">
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {member.wonCount} won
                          </span>
                          <span>·</span>
                          <span className="text-rose-700 dark:text-rose-400">
                            {member.lostCount} lost
                          </span>
                          <span>·</span>
                          <span>{member.openCount} open</span>
                          <span>·</span>
                          <span>{totalDeals} total</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums text-[var(--fg-primary)]">
                        {formatMoneyMicros(member.revenueMicros)}
                      </div>
                      {member.pipelineMicros > 0 && (
                        <div className="text-[10px] tabular-nums text-[var(--fg-tertiary)]">
                          {formatMoneyMicros(member.pipelineMicros)} pipeline
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-card)]">
                    <motion.div
                      className="h-full rounded-full bg-brand"
                      initial={reducedMotion ? false : { width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 + 0.1 }}
                    />
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
      <div className="mb-2 text-2xl opacity-40">👥</div>
      <p className="text-sm font-medium text-[var(--fg-secondary)]">No team data yet</p>
      <p className="text-xs text-[var(--fg-tertiary)]">
        Assign opportunities to owners to see performance.
      </p>
    </div>
  );
}
