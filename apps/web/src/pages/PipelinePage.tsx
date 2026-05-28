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

import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';

import { useReducedMotion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { KanbanSkeleton } from '@/components/skeletons/PageSkeletons';
import { ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useStageMutation } from '@/hooks/useStageMutation';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { getPipelineStages } from '@/lib/pipeline-stages';
import type { Opportunity } from '@bidstack/shared';

import { getStageId, getStageName } from './pipelineBoard/pipelineUtils';
import { StageColumn } from './pipelineBoard/StageColumn';

export function PipelinePage() {
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const { formatMoney } = useFormatMoney();
  const { data, isLoading, isError, error } = useOpportunities({ limit: 50 });
  const move = useStageMutation();

  // Stage filter via the URL. `?pipelineStageId=...` collapses the board to a
  // single column so the user can focus that slice and share the link.
  const [searchParams, setSearchParams] = useSearchParams();
  const stageFilter = searchParams.get('pipelineStageId') ?? null;
  const setStageFilter = (next: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('pipelineStageId', next);
    else params.delete('pipelineStageId');
    setSearchParams(params, { replace: true });
  };

  // Track which opportunity is being dragged + which column is being hovered.
  // Drives drop-target affordances; never sent to the server.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverStageId, setHoverStageId] = useState<string | null>(null);

  // Keyboard alternative: focused card + ←/→ moves between stages. Required
  // for a11y — drag-and-drop is unreachable by keyboard alone (WCAG 2.1.1).
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Derive stage columns from canonical PipelineStage rows, with a legacy
  // fallback for tenants that still only carry the old stage enum.
  const stages = useMemo(() => getPipelineStages(data?.items ?? []), [data?.items]);

  // Group items by pipelineStageId once per data change so each column doesn't
  // filter the whole list on every render.
  const byStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const stage of stages) map.set(stage.id, []);
    map.set('none', []);
    for (const opp of data?.items ?? []) {
      const sid = getStageId(opp);
      const arr = map.get(sid) ?? [];
      arr.push(opp);
      map.set(sid, arr);
    }
    return map;
  }, [data?.items, stages]);

  const handleKey = (e: KeyboardEvent<HTMLAnchorElement>, opp: Opportunity) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const ids = stages.map((s) => s.id);
    const idx = ids.indexOf(getStageId(opp));
    const nextIdx = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= ids.length) return;
    e.preventDefault();
    const nextStageId = ids[nextIdx];
    if (nextStageId) {
      move.mutate(
        { id: opp.id, pipelineStageId: nextStageId },
        {
          onSuccess: () =>
            toast.success(
              `Moved to ${stages.find((s) => s.id === nextStageId)?.name ?? nextStageId}`,
            ),
        },
      );
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, stageId: string) => {
    e.preventDefault();
    setHoverStageId(null);
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const item = data?.items.find((o) => o.id === id);
    if (!item || getStageId(item) === stageId) return;
    move.mutate(
      { id, pipelineStageId: stageId },
      {
        onSuccess: () => toast.success(`Moved "${item.name}" to ${getStageName(item)}`),
        onError: (err) =>
          toast.error('Could not move opportunity', {
            description: err instanceof Error ? err.message : 'The server rejected the request.',
          }),
      },
    );
  };

  const visibleStages = stageFilter ? stages.filter((s) => s.id === stageFilter) : stages;

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
              onChange={(e) => setStageFilter(e.target.value || null)}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-primary)]"
            >
              <option value="">All</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
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

      {/* sr-only live region — announces visible opportunity count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading && data
          ? `${visibleStages.reduce((s, st) => s + (byStage.get(st.id)?.length ?? 0), 0)} opportunit${visibleStages.reduce((s, st) => s + (byStage.get(st.id)?.length ?? 0), 0) === 1 ? 'y' : 'ies'}${stageFilter ? ` · ${stages.find((s) => s.id === stageFilter)?.name ?? ''}` : ''}`
          : ''}
      </p>

      {/* KPI summary bar */}
      {!isLoading && data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-tour="pipeline-kanban">
          {(() => {
            const opps = data.items;
            const totalValue = opps.reduce((acc, o) => acc + o.value, 0);
            const openOpps = opps.filter(
              (o) =>
                o.pipelineStage?.name !== 'Closed Won' && o.pipelineStage?.name !== 'Closed Lost',
            );
            const openValue = openOpps.reduce((acc, o) => acc + o.value, 0);
            const closedWon = opps.filter((o) => o.pipelineStage?.name === 'Closed Won').length;
            const closedLost = opps.filter((o) => o.pipelineStage?.name === 'Closed Lost').length;
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
              { label: 'Active deals', value: String(openOpps.length), tone: 'purple' as const },
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
            // keep the columns flowing.
            stageFilter
              ? 'grid gap-3 grid-cols-1'
              : 'grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-7'
          }
        >
          {visibleStages.map((stage) => {
            const stageIdx = stages.findIndex((s) => s.id === stage.id);
            const items = byStage.get(stage.id) ?? [];
            const total = items.reduce((acc, o) => acc + o.value, 0);
            const isHover = hoverStageId === stage.id;
            // Funnel ratio: how many opps advanced past this stage into any
            // later one. We exclude closed_lost from the "advanced" pool so
            // it isn't counted as forward progress — losses are terminal.
            // The closed_* stages themselves get no chip (no "next" stage).
            const nextStages = stages.slice(stageIdx + 1).filter((s) => s.name !== 'Closed Lost');
            const advanced = nextStages.reduce(
              (acc, s) => acc + (byStage.get(s.id)?.length ?? 0),
              0,
            );
            const totalReached = items.length + advanced;
            const conversion =
              stage.name === 'Closed Won' || stage.name === 'Closed Lost' || totalReached === 0
                ? null
                : Math.round((advanced / totalReached) * 100);
            return (
              <StageColumn
                key={stage.id}
                stageId={stage.id}
                stageName={stage.name}
                stageColor={stage.color}
                items={items}
                total={total}
                conversion={conversion}
                isHoverTarget={isHover}
                draggingId={draggingId}
                focusedId={focusedId}
                onDragOver={(e) => {
                  e.preventDefault();
                  setHoverStageId(stage.id);
                }}
                onDragLeave={() => setHoverStageId(null)}
                onDrop={(e) => handleDrop(e, stage.id)}
                onCardDragStart={(id) => setDraggingId(id)}
                onCardDragEnd={() => {
                  setDraggingId(null);
                  setHoverStageId(null);
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
