import { Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Badge, stageTone } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useOpportunities } from '@/hooks/useOpportunities';
import { formatMoney, formatStage } from '@/lib/format';

const STAGES = [
  'discovery',
  'qualified',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
] as const;

export function PipelinePage() {
  const { data, isLoading } = useOpportunities({ limit: 200 });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
          Pipeline
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Drag opportunities between columns to advance the pipeline.
        </p>
      </header>

      {isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((stage) => {
            const items = data?.items.filter((o) => o.stage === stage) ?? [];
            const total = items.reduce((acc, o) => acc + o.value, 0);
            return (
              <section key={stage} aria-label={formatStage(stage)} className="min-w-0">
                <div className="flex items-center justify-between mb-2 px-1">
                  <Badge tone={stageTone(stage)}>{formatStage(stage)}</Badge>
                  <span className="text-[10px] text-[var(--fg-tertiary)] tabular-nums">
                    {items.length} · {formatMoney(total, 'EUR')}
                  </span>
                </div>
                <ul className="space-y-2">
                  {items.map((o) => (
                    <li key={o.id}>
                      <Card className="p-3 hover:shadow-[var(--shadow-sm)] transition-shadow">
                        <Link to={`/opportunities/${o.id}`} className="block">
                          <div className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                            {o.code}
                          </div>
                          <div className="mt-1 text-xs font-medium text-[var(--fg-primary)] line-clamp-2">
                            {o.name}
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[10px]">
                            <span className="text-[var(--fg-tertiary)]">{o.customer}</span>
                            <span className="tabular-nums font-semibold text-[var(--fg-primary)]">
                              {formatMoney(o.value, 'EUR')}
                            </span>
                          </div>
                        </Link>
                      </Card>
                    </li>
                  ))}
                  {items.length === 0 ? (
                    <li className="rounded-md border border-dashed border-[var(--border-subtle)] p-4 text-[10px] text-[var(--fg-tertiary)] text-center">
                      Empty
                    </li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
