import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';

import { Badge, stageTone } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useStageMutation } from '@/hooks/useStageMutation';
import { formatMoney, formatStage } from '@/lib/format';
import { cn } from '@/lib/cn';

import type { Opportunity, OpportunityStage } from '@bidstack/shared';

const STAGES: OpportunityStage[] = [
  'discovery',
  'qualified',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
];

export function PipelinePage() {
  const { data, isLoading } = useOpportunities({ limit: 200 });
  const move = useStageMutation();

  // Track which opportunity is being dragged + which column is being hovered.
  // Drives drop-target affordances; never sent to the server.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<OpportunityStage | null>(null);

  // Keyboard alternative: focused card + ←/→ moves between stages. Required
  // for a11y — drag-and-drop is unreachable by keyboard alone (WCAG 2.1.1).
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const handleKey = (e: KeyboardEvent<HTMLAnchorElement>, opp: Opportunity) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const idx = STAGES.indexOf(opp.stage);
    const nextIdx = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= STAGES.length) return;
    e.preventDefault();
    const nextStage = STAGES[nextIdx];
    if (nextStage) move.mutate({ id: opp.id, stage: nextStage });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, stage: OpportunityStage) => {
    e.preventDefault();
    setHoverStage(null);
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const item = data?.items.find((o) => o.id === id);
    if (!item || item.stage === stage) return;
    move.mutate({ id, stage });
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            Pipeline
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Drag a card between columns, or focus a card and use ← / → to move stages.
          </p>
        </div>
        {move.isPending ? (
          <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-primary)] animate-pulse"
              aria-hidden
            />
            Updating…
          </div>
        ) : null}
        {move.isError ? (
          <div
            role="alert"
            className="rounded-md bg-[var(--danger-tint)] px-3 py-1.5 text-xs text-[var(--danger)]"
          >
            Move failed — reverted
          </div>
        ) : null}
      </header>

      {isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((stage) => {
            const items = data?.items.filter((o) => o.stage === stage) ?? [];
            const total = items.reduce((acc, o) => acc + o.value, 0);
            const isHover = hoverStage === stage;
            return (
              <section
                key={stage}
                aria-label={`${formatStage(stage)} column with ${items.length} opportunities`}
                className="min-w-0"
              >
                <div className="flex items-center justify-between mb-2 px-1">
                  <Badge tone={stageTone(stage)}>{formatStage(stage)}</Badge>
                  <span className="text-[10px] text-[var(--fg-tertiary)] tabular-nums">
                    {items.length} · {formatMoney(total, 'EUR')}
                  </span>
                </div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setHoverStage(stage);
                  }}
                  onDragLeave={() => setHoverStage(null)}
                  onDrop={(e) => handleDrop(e, stage)}
                  className={cn(
                    'min-h-[120px] rounded-lg p-1 transition-colors',
                    isHover &&
                      'bg-[var(--brand-primary-tint)] outline-2 outline-[var(--brand-primary)]',
                  )}
                >
                  <ul className="space-y-2">
                    {items.map((o) => {
                      const isDragging = draggingId === o.id;
                      const isFocused = focusedId === o.id;
                      return (
                        <li key={o.id}>
                          <Link
                            to={`/opportunities/${o.id}`}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', o.id);
                              e.dataTransfer.effectAllowed = 'move';
                              setDraggingId(o.id);
                            }}
                            onDragEnd={() => {
                              setDraggingId(null);
                              setHoverStage(null);
                            }}
                            onFocus={() => setFocusedId(o.id)}
                            onBlur={() => setFocusedId((f) => (f === o.id ? null : f))}
                            onKeyDown={(e) => handleKey(e, o)}
                            aria-grabbed={isDragging || undefined}
                            aria-label={`${o.code}: ${o.name}, ${formatStage(o.stage)}, ${formatMoney(o.value, 'EUR')}. Use left or right arrows to move stage.`}
                            className={cn(
                              'block cursor-grab active:cursor-grabbing rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 shadow-[var(--shadow-xs)] transition-all hover:shadow-[var(--shadow-sm)]',
                              isDragging && 'opacity-50',
                              isFocused &&
                                'ring-2 ring-offset-1 ring-[var(--brand-primary)] ring-offset-[var(--surface-page)]',
                            )}
                          >
                            <div className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                              {o.code}
                            </div>
                            <div className="mt-1 text-xs font-medium text-[var(--fg-primary)] line-clamp-2">
                              {o.name}
                            </div>
                            <div className="mt-2 flex items-center justify-between text-[10px]">
                              <span className="text-[var(--fg-tertiary)] truncate">
                                {o.customer}
                              </span>
                              <span className="tabular-nums font-semibold text-[var(--fg-primary)] shrink-0 ml-2">
                                {formatMoney(o.value, 'EUR')}
                              </span>
                            </div>
                            <div className="mt-2 h-1 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                              <div
                                className="h-full bg-[var(--brand-primary)]"
                                style={{ width: `${o.probability}%` }}
                                role="meter"
                                aria-valuenow={o.probability}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`${o.probability}% win probability`}
                              />
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                    {items.length === 0 ? (
                      <li className="rounded-md border border-dashed border-[var(--border-subtle)] p-4 text-[10px] text-[var(--fg-tertiary)] text-center">
                        Drop here
                      </li>
                    ) : null}
                  </ul>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
