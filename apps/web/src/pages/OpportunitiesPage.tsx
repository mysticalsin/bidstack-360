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
import { SortableHeader, getSortableHeaderAriaSort } from '@/components/ui/SortableHeader';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useOpportunities, usePatchOpportunity } from '@/hooks/useOpportunities';
import { useStageMutation } from '@/hooks/useStageMutation';
import { useTableSort } from '@/hooks/useTableSort';
import { api } from '@/lib/api';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import {
  getPipelineStages,
  isLegacyOpportunityStage,
  isPipelineStageIdUuid,
  resolvePipelineStage,
} from '@/lib/pipeline-stages';

import type { Opportunity } from '@bidstack/shared';

import { Row } from './opportunities/OpportunityRow';
import { OppBulkBar, OppKpiBar, OppPageHeader, OppStageChips } from './opportunities/OppToolbar';

export function OpportunitiesPage() {
  const { formatMoney } = useFormatMoney();
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

  const { data, isLoading, isError, error } = useOpportunities({
    limit: 100,
    ...(search ? { search } : {}),
    ...(stageFilter
      ? isPipelineStageIdUuid(stageFilter)
        ? { pipelineStageId: stageFilter }
        : isLegacyOpportunityStage(stageFilter)
          ? { stage: stageFilter }
          : {}
      : {}),
  });

  // Sortable. Default = none (server returns by recent activity); user clicks
  // a column header to override. Stage sorts by canonical funnel order rather
  // than alphabetically — that's what users mean when they sort by stage.
  const rawItems = useMemo(() => data?.items ?? [], [data?.items]);
  const stageOptions = useMemo(() => getPipelineStages(rawItems), [rawItems]);
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
    await Promise.all(
      snapshot.map((o) =>
        api(`/api/opportunities/${o.id}`, { method: 'DELETE' }).catch(() => {
          failed += 1;
        }),
      ),
    );
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

  const exportCsv = () => {
    const rows = data?.items ?? [];
    if (rows.length === 0) {
      toast.info('Nothing to export');
      return;
    }
    // Format money/stage at the edge so spreadsheets show "EUR 12,345" and
    // "Closed won" instead of raw micros and snake_case.
    const csv = rowsToCsv(
      rows.map((opp) => ({
        code: opp.code,
        name: opp.name,
        customer: opp.customer,
        stage: resolvePipelineStage(opp).name,
        value: formatMoney(opp.value, 'EUR'),
        probability: `${opp.probability}%`,
        dueDate: opp.dueDate ?? '',
        updatedAt: opp.updatedAt,
      })),
      [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'customer', label: 'Customer' },
        { key: 'stage', label: 'Stage' },
        { key: 'value', label: 'Value' },
        { key: 'probability', label: 'Probability' },
        { key: 'dueDate', label: 'Due date' },
        { key: 'updatedAt', label: 'Updated at' },
      ],
    );
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`bidstack-opportunities-${stamp}`, csv);
    toast.success(`Exported ${rows.length} opportunit${rows.length === 1 ? 'y' : 'ies'}`);
  };

  return (
    <div className="space-y-6">
      {!isLoading && data && data.items.length > 0 && <OppKpiBar opps={data.items} />}

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
        onClearSearch={clearSearch}
        onClearStageFilter={() => setStageFilter(null)}
        onExportCsv={exportCsv}
      />

      {!search && (
        <OppStageChips
          stageFilter={stageFilter}
          stageOptions={stageOptions}
          onSetStageFilter={setStageFilter}
        />
      )}

      {selectedOpps.length > 0 && (
        <OppBulkBar
          selectedCount={selectedOpps.length}
          stageOptions={stageOptions}
          onBulkStageChange={(id) => void bulkStageChange(id)}
          onBulkDelete={() => void bulkDelete()}
          onClearSelection={clearSelection}
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
              <thead className="sticky top-0 z-10 bg-[var(--surface-sunken)] text-xs uppercase tracking-wider text-[var(--fg-tertiary)]">
                <tr>
                  <th scope="col" className="w-10 px-5 py-3">
                    <label className="table-checkbox-hit">
                      <span className="sr-only">{allSelected ? 'Deselect all' : 'Select all'}</span>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        onChange={toggleAll}
                        className="cursor-pointer accent-[var(--brand-primary)]"
                      />
                    </label>
                  </th>
                  <th
                    scope="col"
                    aria-sort={getSortableHeaderAriaSort('code', sortState)}
                    className="px-5 py-3 font-semibold"
                  >
                    <SortableHeader columnKey="code" state={sortState} onChange={setSortState}>
                      Code
                    </SortableHeader>
                  </th>
                  <th
                    scope="col"
                    aria-sort={getSortableHeaderAriaSort('name', sortState)}
                    className="px-5 py-3 font-semibold"
                  >
                    <SortableHeader columnKey="name" state={sortState} onChange={setSortState}>
                      Opportunity
                    </SortableHeader>
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Territory
                  </th>
                  <th
                    scope="col"
                    aria-sort={getSortableHeaderAriaSort('stage', sortState)}
                    className="px-5 py-3 font-semibold"
                  >
                    <SortableHeader columnKey="stage" state={sortState} onChange={setSortState}>
                      Stage
                    </SortableHeader>
                  </th>
                  <th
                    scope="col"
                    aria-sort={getSortableHeaderAriaSort('value', sortState)}
                    className="px-5 py-3 font-semibold"
                  >
                    <SortableHeader
                      columnKey="value"
                      state={sortState}
                      onChange={setSortState}
                      align="right"
                    >
                      Value
                    </SortableHeader>
                  </th>
                  <th
                    scope="col"
                    aria-sort={getSortableHeaderAriaSort('probability', sortState)}
                    className="px-5 py-3 font-semibold"
                  >
                    <SortableHeader
                      columnKey="probability"
                      state={sortState}
                      onChange={setSortState}
                      align="right"
                    >
                      Probability
                    </SortableHeader>
                  </th>
                  <th
                    scope="col"
                    aria-sort={getSortableHeaderAriaSort('dueDate', sortState)}
                    className="px-5 py-3 font-semibold"
                  >
                    <SortableHeader columnKey="dueDate" state={sortState} onChange={setSortState}>
                      Due
                    </SortableHeader>
                  </th>
                </tr>
              </thead>
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
          </div>
        )}
      </Card>
    </div>
  );
}
