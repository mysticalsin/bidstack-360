import { motion, useReducedMotion } from 'framer-motion';
import { Card, SectionHeader } from '@/components/ui/Card';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSoft } from '@/lib/motion';
import type { PipelineStageSnapshot } from '@bidstack/shared';

interface Props {
  stages: PipelineStageSnapshot[];
  isLoading: boolean;
}

const STAGE_COLORS: Record<string, string> = {
  prospecting: '#3b82f6',
  qualification: '#60a5fa',
  proposal: '#f59e0b',
  negotiation: '#f97316',
  'needs_analysis': '#8b5cf6',
  'value_proposition': '#a78bfa',
  'id.decision_makers': '#ec4899',
  'closed_won': '#10b981',
  'closed_lost': '#ef4444',
};

function stageColor(stage: string): string {
  const key = stage.toLowerCase().replace(/\s+/g, '_');
  return STAGE_COLORS[key] ?? STAGE_COLORS[stage] ?? '#6366f1';
}

function stageLabel(stage: string): string {
  return stage
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PipelineSnapshot({ stages, isLoading }: Props) {
  const { formatMoneyMicros } = useFormatMoney();
  const reducedMotion = useReducedMotion();
  const maxValue = stages.reduce((max, s) => Math.max(max, s.valueMicros), 1);
  const totalValue = stages.reduce((sum, s) => sum + s.valueMicros, 0);
  const totalCount = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <Card>
      <SectionHeader
        title="Pipeline by Stage"
        caption={
          totalCount > 0
            ? `${totalCount} opportunities · ${formatMoneyMicros(totalValue)}`
            : undefined
        }
      />
      <div className="px-5 pb-5">
        {isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : stages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {stages.map((stage, index) => {
              const pct = maxValue > 0 ? (stage.valueMicros / maxValue) * 100 : 0;
              return (
                <motion.div
                  key={stage.stage}
                  initial={reducedMotion ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
                  className="group"
                >
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--fg-primary)]">
                      {stageLabel(stage.stage)}
                    </span>
                    <span className="tabular-nums text-[var(--fg-secondary)]">
                      {stage.count} · {formatMoneyMicros(stage.valueMicros)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: stageColor(stage.stage) }}
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
      <div className="mb-2 text-2xl opacity-40">📭</div>
      <p className="text-sm font-medium text-[var(--fg-secondary)]">No active pipeline</p>
      <p className="text-xs text-[var(--fg-tertiary)]">
        Opportunities will appear here once added.
      </p>
    </div>
  );
}
