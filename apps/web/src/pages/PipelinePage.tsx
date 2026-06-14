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

import { useCallback, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';

import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { KanbanSkeleton } from '@/components/skeletons/PageSkeletons';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import {
  getOpportunityStageBusinessKey,
  getPipelineStageBusinessKey,
  getPipelineStages,
} from '@/lib/pipeline-stages';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

import { PipelineViewSwitch } from '@/components/opportunity/PipelineViewSwitch';

import { getStageId } from './pipelineBoard/pipelineUtils';
import { StageColumn } from './pipelineBoard/StageColumn';

export function PipelinePage() {
  const { t } = useTranslation('crm');
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const { formatMoney } = useFormatMoney();
  const { data, isLoading, isError, error } = useOpportunities({ limit: 50 });
  const configuredStages = usePipelineStages();
  // KPI bar reads the server-side aggregate over the WHOLE pipeline — the
  // board itself only loads the first 50 cards, so totals/win-rate computed
  // from `data.items` were silently truncated for any org past 50 deals.
  const report = usePipelineReport();
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

  const configuredStageOptions = useMemo<PipelineStage[]>(
    () =>
      configuredStages.data?.items.map((stage) => ({
        id: stage.id,
        name: stage.name,
        probability: stage.probability,
        color: stage.color,
        isWon: stage.isWon,
        isLost: stage.isLost,
      })) ?? [],
    [configuredStages.data?.items],
  );

  // Stage columns come from CRM configuration, not whichever opportunity
  // records happen to be present in the current page. This keeps empty stages
  // visible and avoids pagination hiding parts of the funnel.
  const stages = useMemo(
    () => getPipelineStages(data?.items ?? [], configuredStageOptions),
    [configuredStageOptions, data?.items],
  );

  const stageIdByBusinessKey = useMemo(
    () => new Map(stages.map((stage) => [getPipelineStageBusinessKey(stage), stage.id])),
    [stages],
  );
  const getVisibleStageId = useCallback(
    (opp: Opportunity) => stageIdByBusinessKey.get(getOpportunityStageBusinessKey(opp)) ?? getStageId(opp),
    [stageIdByBusinessKey],
  );

  // Group items by pipelineStageId once per data change so each column doesn't
  // filter the whole list on every render.
  const byStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const stage of stages) map.set(stage.id, []);
    map.set('none', []);
    for (const opp of data?.items ?? []) {
      const sid = getVisibleStageId(opp);
      const arr = map.get(sid) ?? [];
      arr.push(opp);
      map.set(sid, arr);
    }
    return map;
  }, [data?.items, getVisibleStageId, stages]);

  const handleKey = (e: KeyboardEvent<HTMLAnchorElement>, opp: Opportunity) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const ids = stages.map((s) => s.id);
    const idx = ids.indexOf(getVisibleStageId(opp));
    const nextIdx = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= ids.length) return;
    e.preventDefault();
    const nextStage = stages[nextIdx];
    if (nextStage) {
      move.mutate(
        { id: opp.id, pipelineStageId: nextStage.id, pipelineStage: nextStage },
        {
          onSuccess: () =>
            toast.success(
              t('pipeline.movedToStageToast', 'Moved to {{stage}}', { stage: nextStage.name }),
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
    if (!item || getVisibleStageId(item) === stageId) return;
    const targetStage = stages.find((s) => s.id === stageId);
    const targetStageName = targetStage?.name ?? stageId;
    move.mutate(
      { id, pipelineStageId: stageId, pipelineStage: targetStage },
      {
        onSuccess: () =>
          toast.success(
            t('pipeline.movedOpportunityToast', 'Moved "{{name}}" to {{stage}}', {
              name: item.name,
              stage: targetStageName,
            }),
          ),
        onError: (err) =>
          toast.error(t('pipeline.moveErrorToastTitle', 'Could not move opportunity'), {
            description:
              err instanceof Error
                ? err.message
                : t('pipeline.moveErrorToastDescription', 'The server rejected the request.'),
          }),
      },
    );
  };

  const visibleStages = stageFilter ? stages.filter((s) => s.id === stageFilter) : stages;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
            {t('pipeline.heading', 'Pipeline')}
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {t(
              'pipeline.subtitle',
              'Drag a card between columns, or focus a card and use ← / → to move stages.',
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PipelineViewSwitch current="board" />
          <label className="flex items-center gap-1.5 text-xs text-[var(--fg-tertiary)]">
            <span>{t('pipeline.stageFilterLabel', 'Stage')}</span>
            <select
              aria-label={t('pipeline.stageFilterAriaLabel', 'Filter pipeline by stage')}
              value={stageFilter ?? ''}
              onChange={(e) => setStageFilter(e.target.value || null)}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--fg-primary)]"
            >
              <option value="">{t('pipeline.stageFilterAllOption', 'All')}</option>
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
            {t('pipeline.updatingIndicator', 'Updating…')}
          </div>
        ) : null}
      </header>

      {/* sr-only live region — announces visible opportunity count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading && data
          ? (() => {
              const count = visibleStages.reduce(
                (s, st) => s + (byStage.get(st.id)?.length ?? 0),
                0,
              );
              const filteredStageName = stageFilter
                ? (stages.find((s) => s.id === stageFilter)?.name ?? '')
                : '';
              const label =
                count === 1
                  ? t('pipeline.liveRegionCountOne', '{{count}} opportunity', { count })
                  : t('pipeline.liveRegionCountOther', '{{count}} opportunities', { count });
              return stageFilter ? `${label} · ${filteredStageName}` : label;
            })()
          : ''}
      </p>

      {/* KPI summary bar */}
      {!isLoading && data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-tour="pipeline-kanban">
          {(() => {
            const rep = report.data;
            const byStage = rep?.byStage ?? [];
            const totalValue = byStage.reduce((acc, s) => acc + s.valueSum, 0);
            const closedWon = byStage.find((s) => s.stage === 'closed_won')?.count ?? 0;
            const closedLost = byStage.find((s) => s.stage === 'closed_lost')?.count ?? 0;
            const closedTotal = closedWon + closedLost;
            const winRate =
              closedTotal > 0
                ? `${Math.round((closedWon / closedTotal) * 100)}%`
                : t('pipeline.winRateNoClosedBids', 'No closed bids');
            const loading = report.isLoading;
            return [
              {
                label: t('pipeline.kpiTotalPipeline', 'Total pipeline'),
                value: loading ? '…' : formatMoney(totalValue, 'EUR'),
                tone: 'blue' as const,
              },
              {
                label: t('pipeline.kpiOpenValue', 'Open value'),
                value: loading ? '…' : formatMoney(rep?.totalValueOpen ?? 0, 'EUR'),
                tone: 'jade' as const,
              },
              {
                label: t('pipeline.kpiWinRate', 'Win rate'),
                value: loading ? '…' : winRate,
                tone: 'amber' as const,
              },
              {
                label: t('pipeline.kpiActiveDeals', 'Active deals'),
                value: loading ? '…' : String(rep?.totalOpen ?? 0),
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
          title={t('pipeline.errorTitle', 'Could not load pipeline')}
          message={
            error instanceof Error
              ? error.message
              : t('pipeline.errorMessage', 'Please try again.')
          }
          action={
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-fg-on-brand hover:bg-brand-hover"
            >
              {t('pipeline.errorReloadButton', 'Reload')}
            </button>
          }
        />
      ) : isLoading || (configuredStages.isLoading && configuredStageOptions.length === 0) ? (
        <KanbanSkeleton />
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title={t('pipeline.emptyTitle', 'No opportunities yet')}
          message={t(
            'pipeline.emptyMessage',
            'Create an opportunity to start building your pipeline.',
          )}
          action={
            <button
              type="button"
              onClick={() => navigate('/opportunities')}
              className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-fg-on-brand hover:bg-brand-hover"
            >
              {t('pipeline.emptyGoToOpportunitiesButton', 'Go to Opportunities')}
            </button>
          }
        />
      ) : (
        <div
          className={
            // When filtered to one stage, collapse to a single column so it
            // dominates the screen — the "focus mode" affordance. Otherwise
            // keep a horizontal kanban rail with the design-contract minimum
            // column width; cramped columns make stage labels and cards hard
            // to scan on ordinary laptop widths.
            stageFilter
              ? 'grid gap-3 grid-cols-1'
              : 'grid grid-flow-col auto-cols-[minmax(280px,1fr)] gap-3 overflow-x-auto pb-3'
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
