// Kanban pipeline view. Each stage column is a drop zone; each card is a
// draggable opportunity. We use framer-motion's drag (constrained to the
// viewport) with HTML5 dataTransfer as a fallback for screen readers and
// keyboard users — left/right arrows on a focused card cycle stages, which
// is the WCAG-compliant path the spec requires (HTML5 drag-and-drop is
// unreachable by keyboard alone).
//
// Drop detection: we listen for native onDragOver/onDrop on the column
// because framer-motion's drag doesn't surface drop targets natively. The
// two systems coexist — framer drives the visual spring/inertia, HTML5
// drives the data hand-off.

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { memo, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { KanbanSkeleton } from '@/components/skeletons/PageSkeletons';
import { ErrorState } from '@/components/ui/StateMessages';
import { Badge, stageTone } from '@/components/ui/Badge';
import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useStageMutation } from '@/hooks/useStageMutation';
import { cn } from '@/lib/cn';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { formatDate, formatStage } from '@/lib/format';
import { springLayout, springSnap } from '@/lib/motion';

import type { Opportunity, OpportunityStage } from '@bidstack/shared';

const STAGES: OpportunityStage[] = [
  's1_lead',
  's1_ongoing',
  's2_sent',
  's3_technical_iteration',
  's4_negotiation',
  'closed_won',
  'closed_lost',
];

export function PipelinePage() {
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const { formatMoney } = useFormatMoney();
  const { data, isLoading, isError, error } = useOpportunities({ limit: 50 });
  const move = useStageMutation();
  // Stage filter via the URL. `?stage=qualified` collapses the board to a
  // single column so the user can focus that slice and share the link.
  // Anything we don't recognize falls back to "all stages visible".
  const [searchParams, setSearchParams] = useSearchParams();
  const stageFilterRaw = searchParams.get('stage');
  const stageFilter = STAGES.includes(stageFilterRaw as OpportunityStage)
    ? (stageFilterRaw as OpportunityStage)
    : null;
  const setStageFilter = (next: OpportunityStage | null) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('stage', next);
    else params.delete('stage');
    setSearchParams(params, { replace: true });
  };

  // Track which opportunity is being dragged + which column is being hovered.
  // Drives drop-target affordances; never sent to the server.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<OpportunityStage | null>(null);

  // Keyboard alternative: focused card + ←/→ moves between stages. Required
  // for a11y — drag-and-drop is unreachable by keyboard alone (WCAG 2.1.1).
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Group items by stage once per data change so each column doesn't filter
  // the whole list on every render.
  const byStage = useMemo(() => {
    const map = new Map<OpportunityStage, Opportunity[]>();
    for (const stage of STAGES) map.set(stage, []);
    for (const opp of data?.items ?? []) {
      map.get(opp.stage)?.push(opp);
    }
    return map;
  }, [data?.items]);

  const handleKey = (e: KeyboardEvent<HTMLAnchorElement>, opp: Opportunity) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const idx = STAGES.indexOf(opp.stage);
    const nextIdx = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= STAGES.length) return;
    e.preventDefault();
    const nextStage = STAGES[nextIdx];
    if (nextStage) {
      move.mutate(
        { id: opp.id, stage: nextStage },
        {
          onSuccess: () => toast.success(`Moved to ${formatStage(nextStage)}`),
        },
      );
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, stage: OpportunityStage) => {
    e.preventDefault();
    setHoverStage(null);
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const item = data?.items.find((o) => o.id === id);
    if (!item || item.stage === stage) return;
    move.mutate(
      { id, stage },
      {
        onSuccess: () => toast.success(`Moved "${item.name}" to ${formatStage(stage)}`),
        onError: (err) =>
          toast.error('Could not move opportunity', {
            description: err instanceof Error ? err.message : 'The server rejected the request.',
          }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Pipeline</h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Drag a card between columns, or focus a card and use ← / → to move stages.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/opportunities')}
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-primary)] hover:bg-[var(--surface-hover)]"
          >
            List
          </button>
          <label className="flex items-center gap-1.5 text-xs text-[var(--fg-tertiary)]">
            <span>Stage</span>
            <select
              aria-label="Filter pipeline by stage"
              value={stageFilter ?? ''}
              onChange={(e) => setStageFilter((e.target.value as OpportunityStage) || null)}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-primary)]"
            >
              <option value="">All</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {formatStage(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {move.isPending ? (
          <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-primary)] ${reduced ? '' : 'animate-pulse'}`}
              aria-hidden
            />
            Updating…
          </div>
        ) : null}
      </header>

      {!isLoading && data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(() => {
            const opps = data.items;
            const totalValue = opps.reduce((acc, o) => acc + o.value, 0);
            const openOpps = opps.filter(
              (o) => o.stage !== 'closed_won' && o.stage !== 'closed_lost',
            );
            const openValue = openOpps.reduce((acc, o) => acc + o.value, 0);
            const closedWon = opps.filter((o) => o.stage === 'closed_won').length;
            const closedLost = opps.filter((o) => o.stage === 'closed_lost').length;
            const closedTotal = closedWon + closedLost;
            const winRate =
              closedTotal > 0
                ? `${Math.round((closedWon / closedTotal) * 100)}%`
                : 'No closed bids';
            return [
              {
                label: 'Total pipeline',
                value: formatMoney(totalValue, 'EUR'),
                tone: 'blue' as const,
              },
              { label: 'Open value', value: formatMoney(openValue, 'EUR'), tone: 'jade' as const },
              { label: 'Win rate', value: winRate, tone: 'amber' as const },
              {
                label: 'Active deals',
                value: String(openOpps.length),
                tone: 'purple' as const,
              },
            ];
          })().map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {kpi.label}
              </div>
              <div className="mt-1 text-lg font-bold text-[var(--fg-primary)] tabular-nums">
                {kpi.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {isError ? (
        <ErrorState
          title="Could not load pipeline"
          message={error instanceof Error ? error.message : 'Please try again.'}
          action={
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-fg-on-brand hover:bg-brand-hover"
            >
              Reload
            </button>
          }
        />
      ) : isLoading ? (
        <KanbanSkeleton />
      ) : (
        <div
          className={
            // When filtered to one stage, collapse to a single column so it
            // dominates the screen — the "focus mode" affordance. Otherwise
            // keep the 6-column funnel.
            stageFilter
              ? 'grid gap-3 grid-cols-1'
              : 'grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-7'
          }
        >
          {(stageFilter ? [stageFilter] : STAGES).map((stage) => {
            const stageIdx = STAGES.indexOf(stage);
            const items = byStage.get(stage) ?? [];
            const total = items.reduce((acc, o) => acc + o.value, 0);
            const isHover = hoverStage === stage;
            // Funnel ratio: how many opps advanced past this stage into any
            // later one. We exclude closed_lost from the "advanced" pool so
            // it isn't counted as forward progress — losses are terminal.
            // The closed_* stages themselves get no chip (no "next" stage).
            const nextStages = STAGES.slice(stageIdx + 1).filter((s) => s !== 'closed_lost');
            const advanced = nextStages.reduce((acc, s) => acc + (byStage.get(s)?.length ?? 0), 0);
            const totalReached = items.length + advanced;
            const conversion =
              stage === 'closed_won' || stage === 'closed_lost' || totalReached === 0
                ? null
                : Math.round((advanced / totalReached) * 100);
            return (
              <StageColumn
                key={stage}
                stage={stage}
                items={items}
                total={total}
                conversion={conversion}
                isHoverTarget={isHover}
                draggingId={draggingId}
                focusedId={focusedId}
                onDragOver={(e) => {
                  e.preventDefault();
                  setHoverStage(stage);
                }}
                onDragLeave={() => setHoverStage(null)}
                onDrop={(e) => handleDrop(e, stage)}
                onCardDragStart={(id) => setDraggingId(id)}
                onCardDragEnd={() => {
                  setDraggingId(null);
                  setHoverStage(null);
                }}
                onCardFocus={(id) => setFocusedId(id)}
                onCardBlur={(id) => setFocusedId((f) => (f === id ? null : f))}
                onCardKey={handleKey}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// One stage column. Memoized so reordering inside another column doesn't
// re-render the other 5 columns — only the source/destination columns
// actually change.
const StageColumn = memo(function StageColumn({
  stage,
  items,
  total,
  conversion,
  isHoverTarget,
  draggingId,
  focusedId,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardDragStart,
  onCardDragEnd,
  onCardFocus,
  onCardBlur,
  onCardKey,
}: {
  stage: OpportunityStage;
  items: Opportunity[];
  total: number;
  /** % of opps that have advanced past this stage (excludes closed_lost). */
  conversion: number | null;
  isHoverTarget: boolean;
  draggingId: string | null;
  focusedId: string | null;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onCardDragStart: (id: string) => void;
  onCardDragEnd: () => void;
  onCardFocus: (id: string) => void;
  onCardBlur: (id: string) => void;
  onCardKey: (e: KeyboardEvent<HTMLAnchorElement>, opp: Opportunity) => void;
}) {
  return (
    <section
      aria-label={`${formatStage(stage)} column with ${items.length} opportunities`}
      className="min-w-0"
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <Badge tone={stageTone(stage)}>{formatStage(stage)}</Badge>
          {conversion !== null ? (
            <span
              title={`${conversion}% of opps in this stage or later have advanced past it`}
              aria-label={`Conversion rate: ${conversion}%`}
              className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-[var(--fg-secondary)]"
            >
              <span aria-hidden>→</span>
              {conversion}%
            </span>
          ) : null}
        </div>
        <span className="text-[10px] text-[var(--fg-tertiary)] tabular-nums">
          <AnimatedNumber value={items.length} duration={0.6} />
          {' · '}
          <AnimatedNumber
            value={total}
            duration={0.7}
            // Reuse the locale-aware money formatter so EUR / comma-grouping
            // matches the rest of the page. The cents portion would jitter
            // during the tween — keep precision at whole units.
            format={(n) =>
              new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: 'EUR',
                maximumFractionDigits: 0,
              }).format(Math.round(n))
            }
          />
        </span>
      </div>
      <GlassCard
        padding="none"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        animate={{
          backgroundColor: isHoverTarget ? 'var(--brand-primary-tint)' : 'rgba(0,0,0,0)',
          borderColor: isHoverTarget ? 'var(--brand-primary)' : 'var(--border-subtle)',
        }}
        transition={springSnap}
        className={cn(
          'min-h-[200px] border border-[var(--border-subtle)] bg-[var(--surface-sunken-alpha)]',
          isHoverTarget &&
            'ring-2 ring-[var(--brand-primary)] ring-offset-2 ring-offset-[var(--surface-page)]',
        )}
      >
        <ul className="space-y-2 p-1.5">
          <AnimatePresence initial={false}>
            {items.map((o) => (
              <PipelineCard
                key={o.id}
                opp={o}
                isDragging={draggingId === o.id}
                isFocused={focusedId === o.id}
                onDragStart={onCardDragStart}
                onDragEnd={onCardDragEnd}
                onFocus={onCardFocus}
                onBlur={onCardBlur}
                onKey={onCardKey}
              />
            ))}
          </AnimatePresence>
          {items.length === 0 ? (
            <li className="flex h-32 items-center justify-center rounded-xl border border-dashed border-[var(--border-subtle)] p-4 text-[10px] font-medium text-[var(--fg-tertiary)] uppercase tracking-widest">
              Drop here
            </li>
          ) : null}
        </ul>
      </GlassCard>
    </section>
  );
});

// Card. Memoized so a column re-render (e.g. another card moved out) doesn't
// re-render every remaining card.
const PipelineCard = memo(function PipelineCard({
  opp,
  isDragging,
  isFocused,
  onDragStart,
  onDragEnd,
  onFocus,
  onBlur,
  onKey,
}: {
  opp: Opportunity;
  isDragging: boolean;
  isFocused: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onFocus: (id: string) => void;
  onBlur: (id: string) => void;
  onKey: (e: KeyboardEvent<HTMLAnchorElement>, opp: Opportunity) => void;
}) {
  const reduced = useReducedMotion();
  const { formatMoney } = useFormatMoney();
  const isStalled =
    opp.dueDate != null &&
    new Date(opp.dueDate) < new Date() &&
    opp.stage !== 'closed_won' &&
    opp.stage !== 'closed_lost';
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{
        opacity: isDragging ? 0.5 : 1,
        y: 0,
        scale: isDragging ? 1.02 : 1,
      }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
      whileHover={reduced || isDragging ? undefined : { y: -2 }}
      transition={springLayout}
    >
      <Link
        to={`/opportunities/${opp.id}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', opp.id);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(opp.id);
        }}
        onDragEnd={onDragEnd}
        onFocus={() => onFocus(opp.id)}
        onBlur={() => onBlur(opp.id)}
        onKeyDown={(e) => onKey(e, opp)}
        aria-roledescription="draggable opportunity"
        aria-label={`${opp.code}: ${opp.name}, ${formatStage(opp.stage)}, ${formatMoney(opp.value, 'EUR')}. Use left or right arrows to move stage.`}
        className={cn(
          'block cursor-grab active:cursor-grabbing rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 shadow-[var(--shadow-xs)] transition-shadow hover:shadow-[var(--shadow-sm)]',
          isFocused &&
            'ring-2 ring-offset-1 ring-[var(--brand-primary)] ring-offset-[var(--surface-page)]',
          isStalled && 'border-red-300/40 bg-red-50/40 dark:border-red-900/30 dark:bg-red-950/20',
        )}
      >
        {/* Company name + value */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-semibold text-[var(--fg-primary)] truncate">
            {opp.customer}
          </span>
          <span className="tabular-nums text-[11px] font-bold text-[var(--fg-primary)] shrink-0">
            {formatMoney(opp.value, 'EUR')}
          </span>
        </div>

        {/* Opportunity title */}
        <div className="mt-1 text-xs font-medium text-[var(--fg-secondary)] line-clamp-2">
          {opp.name}
        </div>

        {/* Territory badge */}
        {opp.territoryName && (
          <div className="mt-1.5">
            <Badge tone="teal" className="text-[9px] px-1.5 py-0">
              {opp.territoryName}
            </Badge>
          </div>
        )}

        {/* Activity row */}
        <div className="mt-2 flex items-center gap-3 text-[var(--fg-tertiary)]">
          <span className="inline-flex items-center gap-0.5 text-[10px]" title="Views">
            <Icon name="eye" size={12} strokeWidth={2} />
            <span className="tabular-nums">{opp.viewCount ?? 0}</span>
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px]" title="Comments">
            <Icon name="messageCircle" size={12} strokeWidth={2} />
            <span className="tabular-nums">{opp.commentCount ?? 0}</span>
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px]" title="Tasks">
            <Icon name="checkCircle" size={12} strokeWidth={2} />
            <span className="tabular-nums">{opp.taskCount ?? 0}</span>
          </span>
        </div>

        {/* Date + code */}
        <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--fg-tertiary)]">
          <span className="inline-flex items-center gap-1">
            <Icon name="clock" size={10} strokeWidth={2} />
            {opp.dueDate ? formatDate(opp.dueDate) : 'No date'}
          </span>
          <span className="font-mono">{opp.code}</span>
        </div>
      </Link>
    </motion.li>
  );
});
