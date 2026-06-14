// CRM-style opportunities table with inline-editable stage, value,
// probability, and due date. Each row owns its own mutation hook so a
// PATCH on row N doesn't trigger renders on row M.
// Rendering is delegated to opportunities/ sub-modules — this file owns
// only state, sort, bulk-selection, and data-fetching concerns.

import { useCallback, useMemo, useState, useTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { Card } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useOpportunities, usePatchOpportunity } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { useStageMutation } from '@/hooks/useStageMutation';
import { useTableSort } from '@/hooks/useTableSort';
import { api, downloadFromApi } from '@/lib/api';
import {
  getPipelineStages,
  isLegacyOpportunityStage,
  isPipelineStageIdUuid,
  resolvePipelineStage,
} from '@/lib/pipeline-stages';

import type { Opportunity, PipelineStage } from '@bidstack/shared';

import { Row } from './opportunities/OpportunityRow';
import { OpportunitiesTableHead } from './opportunities/OpportunitiesTableHead';
import { OppBulkBar, OppKpiBar, OppPageHeader, OppStageChips } from './opportunities/OppToolbar';
import { OppIndustryBreakdown } from './opportunities/OppIndustryBreakdown';

export function OpportunitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') ?? undefined;
  const qc = useQueryClient();
  // useTransition: typing in the search box (URL state) is urgent; the
  // table re-render is non-urgent.
  const [, startTransition] = useTransition();

  // Stage filter chips (CRM-style quick filters)
  const stageFilter = searchParams.get('pipelineStageId') ?? null;
  const setStageFilter = (next: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('pipelineStageId', next);
    else params.delete('pipelineStageId');
    params.delete('search'); // clear search when switching stage filter
    setSearchParams(params, { replace: true });
  };

  // Cursor pagination — reset to page 1 whenever the search/stage filter changes.
  const pager = useCursorPagination(`${search}|${stageFilter}`);
  const { data, isLoading, isError, error } = useOpportunities({
    limit: 50,
    ...(pager.cursor ? { cursor: pager.cursor } : {}),
    ...(search ? { search } : {}),
    ...(stageFilter
      ? isPipelineStageIdUuid(stageFilter)
        ? { pipelineStageId: stageFilter }
        : isLegacyOpportunityStage(stageFilter)
          ? { stage: stageFilter }
          : {}
      : {}),
  });
  const configuredStages = usePipelineStages();
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

  // Sortable. Default = none (server returns by recent activity); user clicks
  // a column header to override. Stage sorts by canonical funnel order rather
  // than alphabetically — that's what users mean when they sort by stage.
  const rawItems = useMemo(() => data?.items ?? [], [data?.items]);
  const stageOptions = useMemo(
    () => getPipelineStages(rawItems, configuredStageOptions),
    [configuredStageOptions, rawItems],
  );
  const accessors = useMemo(
    () => ({
      code: (o: Opportunity) => o.code,
      name: (o: Opportunity) => o.name,
      customer: (o: Opportunity) => o.customer,
      stage: (o: Opportunity) => resolvePipelineStage(o).name,
      value: (o: Opportunity) => o.value,
      probability: (o: Opportunity) => o.probability,
      dueDate: (o: Opportunity) => o.dueDate,
    }),
    [],
  );

  // Persist sort in the URL — same format as Contacts ("?sort=value.desc").
  type OppSortKey = keyof typeof accessors;
  const parseSortParam = (
    raw: string | null,
  ): { key: OppSortKey | null; dir: 'asc' | 'desc' | null } => {
    if (!raw) return { key: null, dir: null };
    const [k, d] = raw.split('.');
    if (!k || !d) return { key: null, dir: null };
    if (!(k in accessors)) return { key: null, dir: null };
    if (d !== 'asc' && d !== 'desc') return { key: null, dir: null };
    return { key: k as OppSortKey, dir: d };
  };
  const sortState = parseSortParam(searchParams.get('sort'));
  const setSortState = (next: { key: OppSortKey | null; dir: 'asc' | 'desc' | null }) => {
    const params = new URLSearchParams(searchParams);
    if (!next.key || !next.dir) params.delete('sort');
    else params.set('sort', `${next.key}.${next.dir}`);
    setSearchParams(params, { replace: true });
  };
  const { sorted: items } = useTableSort(rawItems, accessors, {
    state: sortState,
    onChange: setSortState,
  });

  // Bulk selection (parity with Contacts). Bulk stage change uses the
  // existing /opportunities/:id/stage endpoint, parallelized.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const allSelected = items.length > 0 && items.every((o) => selectedIds.has(o.id));
  const someSelected = !allSelected && items.some((o) => selectedIds.has(o.id));
  const toggleOne = useCallback(
    (id: string) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const toggleAll = useCallback(
    () =>
      setSelectedIds((prev) => {
        if (items.every((o) => prev.has(o.id))) return new Set();
        return new Set(items.map((o) => o.id));
      }),
    [items],
  );
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const selectedOpps = useMemo(
    () => items.filter((o) => selectedIds.has(o.id)),
    [items, selectedIds],
  );

  const [isExporting, setIsExporting] = useState(false);
  // Tracks bulk-delete in-flight so OppBulkBar can disable its buttons (P1 #24).
  // bulkDelete is a plain async fn (no React Query mutation), so isPending isn't
  // available from a mutation object — local boolean is the right tool here.
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);

  const patch = usePatchOpportunity();
  const stageMove = useStageMutation();

  const bulkStageChange = async (pipelineStageId: string) => {
    if (selectedOpps.length === 0) return;
    const snapshot = [...selectedOpps];
    let failed = 0;
    await Promise.all(
      snapshot.map((o) =>
        stageMove.mutateAsync({ id: o.id, pipelineStageId }).catch(() => {
          failed += 1;
        }),
      ),
    );
    if (failed === 0) {
      toast.success(`Moved ${snapshot.length} opportunit${snapshot.length === 1 ? 'y' : 'ies'}`);
      clearSelection();
    } else {
      toast.error(`${failed} update${failed === 1 ? '' : 's'} failed`, {
        description: 'The successful moves were committed; try again for the rest.',
      });
    }
  };

  const bulkDelete = async () => {
    if (selectedOpps.length === 0) return;
    const n = selectedOpps.length;
    const ok = await confirm({
      title: `Delete ${n} opportunit${n === 1 ? 'y' : 'ies'}?`,
      description: 'This cannot be undone from the UI — the audit log records each delete.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const snapshot = [...selectedOpps];
    clearSelection();
    let failed = 0;
    setIsDeletingBulk(true);
    try {
      await Promise.all(
        snapshot.map((o) =>
          api(`/api/opportunities/${o.id}`, { method: 'DELETE' }).catch(() => {
            failed += 1;
          }),
        ),
      );
    } finally {
      setIsDeletingBulk(false);
    }
    // Invalidate regardless of partial failure — some may have succeeded.
    void qc.invalidateQueries({ queryKey: ['opportunities'] });
    if (failed === 0) {
      toast.success(`Deleted ${snapshot.length} opportunit${snapshot.length === 1 ? 'y' : 'ies'}`);
    } else {
      toast.error(`${failed} delete${failed === 1 ? '' : 's'} failed`);
    }
  };

  const clearSearch = () => {
    startTransition(() => {
      const next = new URLSearchParams(searchParams);
      next.delete('search');
      setSearchParams(next);
    });
  };

  // WHY backend streaming: the previous client-side export was capped at the
  // in-memory page (100 rows). The backend streams all matching opportunities
  // cursor-paginated from Postgres — no row limit, flat heap.
  const exportCsv = async () => {
    if (isExporting) return;
    const stamp = new Date().toISOString().slice(0, 10);
    setIsExporting(true);
    try {
      await downloadFromApi('/api/opportunities/export', `bidstack-opportunities-${stamp}.csv`, {
        querystring: {
          pipelineStageId: stageFilter ?? undefined,
        },
      });
      toast.success('Export complete');
    } catch {
      toast.error('Export failed', { description: 'Try again in a moment.' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div aria-hidden="true" className="grid min-h-[74px] grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3"
            >
              <div className="h-3 w-20 rounded bg-[var(--surface-sunken)]" />
              <div className="mt-2 h-5 w-24 rounded bg-[var(--surface-sunken)]" />
            </div>
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <OppKpiBar opps={data.items} />
      ) : null}

      {/* sr-only live region — announces filter/search result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading && data
          ? search
            ? `${data.items.length} opportunit${data.items.length === 1 ? 'y' : 'ies'} matching "${search}"`
            : stageFilter
              ? `${data.items.length} opportunit${data.items.length === 1 ? 'y' : 'ies'} in selected stage`
              : `${data.items.length} opportunit${data.items.length === 1 ? 'y' : 'ies'}`
          : ''}
      </p>

      <OppPageHeader
        search={search}
        stageFilter={stageFilter}
        itemCount={data?.items.length ?? 0}
        hasData={Boolean(data && data.items.length > 0)}
        isExporting={isExporting}
        onClearSearch={clearSearch}
        onClearStageFilter={() => setStageFilter(null)}
        onExportCsv={() => void exportCsv()}
      />

      {!search && (
        <OppStageChips
          stageFilter={stageFilter}
          stageOptions={stageOptions}
          onSetStageFilter={setStageFilter}
        />
      )}

      {/* Industry visibility — the bids we're working on, split by sector. */}
      <OppIndustryBreakdown />

      {selectedOpps.length > 0 && (
        <OppBulkBar
          selectedCount={selectedOpps.length}
          stageOptions={stageOptions}
          onBulkStageChange={(id) => void bulkStageChange(id)}
          onBulkDelete={() => void bulkDelete()}
          onClearSelection={clearSelection}
          isPending={stageMove.isPending || isDeletingBulk}
        />
      )}

      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={8} columns={6} headless />
        ) : isError ? (
          <ErrorState
            title="Couldn't load opportunities"
            message={error?.message ?? 'Try again in a moment.'}
          />
        ) : data?.items.length === 0 ? (
          <EmptyState
            title="No opportunities yet"
            message="Create your first opportunity to start tracking bids."
            action={<CreateOpportunityDialog />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <caption className="sr-only">
                {search
                  ? `Opportunities matching "${search}"`
                  : 'All opportunities, sorted by most recent activity. Cells are inline-editable.'}
              </caption>
              <OpportunitiesTableHead
                sortState={sortState}
                setSortState={setSortState}
                allSelected={allSelected}
                someSelected={someSelected}
                toggleAll={toggleAll}
              />
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {items.map((opp) => (
                  <Row
                    key={opp.id}
                    opp={opp}
                    stageOptions={stageOptions}
                    isSelected={selectedIds.has(opp.id)}
                    onToggleSelect={toggleOne}
                    patch={patch}
                  />
                ))}
              </tbody>
            </table>
            <CursorPager
              currentPage={pager.page}
              hasNext={Boolean(data?.nextCursor)}
              hasPrevious={pager.hasPrevious}
              isLoading={isLoading}
              itemCount={data?.items.length ?? 0}
              label="opportunities"
              onNext={() => pager.goNext(data?.nextCursor)}
              onPrevious={pager.goPrevious}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
