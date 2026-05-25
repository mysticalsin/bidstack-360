// CRM-style opportunities table with inline-editable stage, value,
// probability, and due date. Each row owns its own mutation hook so a
// PATCH on row N doesn't trigger renders on row M. Stage is a select cell
// (the most common field to edit during pipeline review); the rest are
// click-to-edit text/number/date.

import { motion } from 'framer-motion';
import {
  memo,
  useCallback,
  useTransition,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { announceStageChange } from '@/components/a11y/useAnnouncer';
import { useConfetti } from '@/components/delight/useConfetti';
import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { ImportOpportunitiesDialog } from '@/components/opportunity/ImportOpportunitiesDialog';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, stageTone } from '@/components/ui/Badge';
import { confirm } from '@/components/ui/ConfirmDialog';
import { SavedFlash } from '@/components/ui/SavedFlash';
import { SortableHeader, getSortableHeaderAriaSort } from '@/components/ui/SortableHeader';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useLiveRelativeTime } from '@/hooks/useLiveRelativeTime';
import { useOpportunities, usePatchOpportunity } from '@/hooks/useOpportunities';
import { useStageMutation } from '@/hooks/useStageMutation';
import { useTableSort } from '@/hooks/useTableSort';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import { prefetchRoute } from '@/lib/prefetch';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { formatDate, formatStage } from '@/lib/format';
import {
  getPipelineStages,
  isLegacyOpportunityStage,
  isPipelineStageIdUuid,
  resolvePipelineStage,
} from '@/lib/pipeline-stages';

import type { Opportunity, PipelineStage } from '@bidstack/shared';

export function OpportunitiesPage() {
  const navigate = useNavigate();
  const { formatMoney } = useFormatMoney();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') ?? undefined;
  const qc = useQueryClient();
  // useTransition: typing in the search box (handled at the parent above
  // via URL state) is urgent, but the table re-render is non-urgent.
  const [, startTransition] = useTransition();

  // Stage filter chips (CRM-style quick filters)
  const stageFilterRaw = searchParams.get('pipelineStageId');
  const stageFilter = stageFilterRaw ?? null;
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

  // Sortable. Default sort = none (server returns by recent activity); the
  // user clicks a column header to override. Stage sorts by the canonical
  // funnel order rather than alphabetically — that's what users mean when
  // they sort by stage.
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
      toast.success(
        `Moved ${snapshot.length} opportunit${snapshot.length === 1 ? 'y' : 'ies'}`,
      );
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
    // Invalidate so the list refreshes after the parallel deletes settle.
    // We do this regardless of failure because some may have succeeded.
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
      {!isLoading && data && data.items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(() => {
            const opps = data.items;
            const totalValue = opps.reduce((acc, o) => acc + o.value, 0);
            const openOpps = opps.filter(
              (o) => !o.pipelineStage?.isWon && !o.pipelineStage?.isLost,
            );
            const openValue = openOpps.reduce((acc, o) => acc + o.value, 0);
            const weighted = openOpps.reduce((acc, o) => acc + o.value * (o.probability / 100), 0);
            return [
              { label: 'Opportunities', value: String(opps.length) },
              { label: 'Revenue', value: formatMoney(totalValue, 'EUR') },
              { label: 'WR', value: formatMoney(weighted, 'EUR') },
              { label: 'Open', value: formatMoney(openValue, 'EUR') },
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

      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight gradient-text">
            Opportunities
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {search ? (
              <>
                <span className="font-medium text-[var(--fg-primary)]">
                  {data?.items.length ?? 0}
                </span>{' '}
                results for{' '}
                <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-xs">
                  &ldquo;{search}&rdquo;
                </span>{' '}
                <button
                  type="button"
                  onClick={clearSearch}
                  className="ml-2 text-xs text-[var(--fg-tertiary)] underline hover:text-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] rounded"
                >
                  clear
                </button>
              </>
            ) : stageFilter ? (
              <>
                <span className="font-medium text-[var(--fg-primary)]">
                  {data?.items.length ?? 0}
                </span>{' '}
                {formatStage(stageFilter).toLowerCase()} opportunities
                <button
                  type="button"
                  onClick={() => setStageFilter(null)}
                  className="ml-2 text-xs text-[var(--fg-tertiary)] underline hover:text-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] rounded"
                >
                  clear filter
                </button>
              </>
            ) : (
              <>{data?.items.length ?? 0} bids in flight · click any cell to edit inline.</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate('/pipeline')}
            aria-label="Switch to kanban view"
          >
            Kanban
          </Button>
          <ImportOpportunitiesDialog />
          <Button
            size="sm"
            variant="secondary"
            onClick={exportCsv}
            disabled={!data || data.items.length === 0}
            aria-label="Export visible opportunities as CSV"
          >
            Export CSV
          </Button>
          <CreateOpportunityDialog />
        </div>
      </header>

      {/* Stage filter chips — CRM-style quick filters */}
      {!search && (
        <div
          role="group"
          aria-label="Filter opportunities by stage"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            aria-pressed={!stageFilter}
            onClick={() => setStageFilter(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] ${
              !stageFilter
                ? 'bg-[var(--fg-primary)] text-[var(--surface-page)]'
                : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            All
          </button>
          {stageOptions.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={stageFilter === s.id}
                onClick={() => setStageFilter(stageFilter === s.id ? null : s.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] ${
                  stageFilter === s.id
                    ? 'bg-[var(--fg-primary)] text-[var(--surface-page)]'
                    : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                {s.name}
              </button>
            ))}
        </div>
      )}

      {selectedOpps.length > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] px-3 py-2 text-xs shadow-[var(--shadow-sm)] backdrop-blur"
        >
          <span className="font-medium text-[var(--fg-primary)]">
            {selectedOpps.length} selected
          </span>
          <div className="flex items-center gap-2">
            <select
              aria-label="Move selection to stage"
              defaultValue=""
              onChange={(e) => {
                const next = e.target.value;
                if (next) {
                  void bulkStageChange(next);
                  e.target.value = '';
                }
              }}
              className="dialog-input"
            >
              <option value="">Move to stage…</option>
              {stageOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              onClick={bulkDelete}
              className="text-[var(--danger)] hover:text-[var(--danger)]"
            >
              Delete selected
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

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
            <table className="min-w-[980px] w-full text-left text-sm">
              <caption className="sr-only">
                {search
                  ? `Opportunities matching "${search}"`
                  : 'All opportunities, sorted by most recent activity. Cells are inline-editable.'}
              </caption>
              <thead className="sticky top-0 z-10 bg-[var(--surface-sunken)] text-xs text-[var(--fg-tertiary)] uppercase tracking-wider">
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

// One row. Receives a shared patch mutation so we avoid creating 100
// useMutation hooks (one per row) which is expensive for React Query.
const Row = memo(function Row({
  opp,
  stageOptions,
  isSelected,
  onToggleSelect,
  patch,
}: {
  opp: Opportunity;
  stageOptions: PipelineStage[];
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  patch: ReturnType<typeof usePatchOpportunity>;
}) {
  const { formatMoney } = useFormatMoney();
  const fireConfetti = useConfetti((s) => s.fire);
  // Per-field flash timestamp. Bumping a field's value re-triggers the
  // SavedFlash chip next to that cell, independent of the others.
  const [saved, setSaved] = useState<{
    stage: number;
    value: number;
    probability: number;
    dueDate: number;
  }>({ stage: 0, value: 0, probability: 0, dueDate: 0 });

  const flash = (field: 'stage' | 'value' | 'probability' | 'dueDate') =>
    setSaved((s) => ({ ...s, [field]: s[field] + 1 }));

  const savedToast = (field: string) => toast.success(`${field} updated`, { duration: 2200 });
  const errorToast = (err: unknown) =>
    toast.error('Update failed', {
      description: err instanceof Error ? err.message : 'The server rejected the request.',
    });

  // Hover-prefetch the detail route. Apple's "look at it before tap" feel —
  // by the time the click lands, the lazy chunk is parsed and the React
  // Query cache is warm via the route's loader (if any).
  const prefetch = () => {
    prefetchRoute('/opportunities/:id');
  };

  return (
    <tr
      className={cn(
        'group transition-colors hover:bg-[var(--surface-sunken)]',
        isSelected && 'bg-[var(--brand-primary-tint)]/60',
      )}
      data-selected={isSelected ? 'true' : undefined}
      onMouseEnter={prefetch}
    >
      <td className="w-10 px-5 py-3">
        <label className="table-checkbox-hit">
          <span className="sr-only">
            {isSelected ? `Deselect ${opp.name}` : `Select ${opp.name}`}
          </span>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(opp.id)}
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer accent-[var(--brand-primary)]"
          />
        </label>
      </td>
      <td className="px-5 py-3 font-mono text-xs text-[var(--fg-tertiary)]">
        <Link to={`/opportunities/${opp.id}`} className="hover:text-[var(--brand-primary)]">
          {opp.code}
        </Link>
      </td>
      <td className="px-5 py-3">
        <Link
          to={`/opportunities/${opp.id}`}
          className="font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
        >
          {opp.name}
        </Link>
        <div className="text-xs text-[var(--fg-tertiary)]">
          <span>{opp.customer}</span>
          <UpdatedAgo iso={opp.updatedAt} />
        </div>
      </td>
      <td className="px-5 py-3">
        {opp.territoryName ? (
          <Badge tone="teal">{opp.territoryName}</Badge>
        ) : opp.country ? (
          <span className="text-xs text-[var(--fg-tertiary)]">{opp.country}</span>
        ) : (
          <span className="text-xs text-[var(--fg-tertiary)]">—</span>
        )}
      </td>
      <td className="px-5 py-3">
        <StageCell
          stage={resolvePipelineStage(opp)}
          options={stageOptions}
          onSave={(nextId) => {
            const nextStage = stageOptions.find((s) => s.id === nextId);
            patch.mutate(
              {
                id: opp.id,
                patch: isPipelineStageIdUuid(nextId)
                  ? { pipelineStageId: nextId }
                  : { stage: nextId, pipelineStageId: null },
              },
              {
                onSuccess: () => {
                  savedToast('Stage');
                  flash('stage');
                  // The "you won this one" moment — confetti only on
                  // closed_won, never on closed_lost (no celebration for
                  // a lost bid).
                  if (nextStage?.isWon) {
                    fireConfetti();
                    toast.success(`🎉 Won "${opp.name}"!`, { duration: 5000 });
                  }
                  // Announce every stage move to screen readers — this is
                  // the most consequential edit on the page and the live
                  // region keeps SR users in sync.
                  announceStageChange(`${opp.name} moved to ${nextStage?.name ?? nextId}`);
                },
                onError: errorToast,
              },
            );
          }}
        />
        <SavedFlash trigger={saved.stage} />
      </td>
      <td className="px-5 py-3 text-right">
        <NumberCell
          value={opp.value}
          step={1000}
          min={0}
          align="right"
          format={(v) => formatMoney(v, 'EUR')}
          onSave={(next) => {
            patch.mutate(
              { id: opp.id, patch: { value: next } },
              {
                onSuccess: () => {
                  savedToast('Value');
                  flash('value');
                },
                onError: errorToast,
              },
            );
          }}
        />
        <SavedFlash trigger={saved.value} />
      </td>
      <td className="px-5 py-3 text-right">
        <NumberCell
          value={opp.probability}
          min={0}
          max={100}
          step={5}
          align="right"
          format={(v) => `${v}%`}
          onSave={(next) => {
            patch.mutate(
              { id: opp.id, patch: { probability: next } },
              {
                onSuccess: () => {
                  savedToast('Probability');
                  flash('probability');
                },
                onError: errorToast,
              },
            );
          }}
        />
        <SavedFlash trigger={saved.probability} />
      </td>
      <td className="px-5 py-3">
        <DateCell
          value={opp.dueDate}
          format={(v) => formatDate(v)}
          onSave={(next) => {
            patch.mutate(
              { id: opp.id, patch: { dueDate: next } },
              {
                onSuccess: () => {
                  savedToast('Due date');
                  flash('dueDate');
                },
                onError: errorToast,
              },
            );
          }}
        />
        <SavedFlash trigger={saved.dueDate} />
      </td>
    </tr>
  );
});

// ── Inline-edit cells ────────────────────────────────────────────────────

function StageCell({
  stage,
  options,
  onSave,
}: {
  stage: PipelineStage | null;
  options: PipelineStage[];
  onSave: (nextId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const value = stage?.id ?? '';
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-edit-trigger"
        aria-label={`Stage: ${stage?.name ?? 'Unknown'}. Click to change.`}
      >
        {/* Key on `value` so the badge remounts when the stage changes —
            the spring then plays from scale 0.85 to 1, signalling the
            change. Same trick used by macOS for badge updates. */}
        <motion.span
          key={value}
          initial={{ scale: 0.85, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          className="inline-block"
        >
          <Badge tone={stageTone(stage?.name ?? '')}>{stage?.name ?? 'Unknown'}</Badge>
        </motion.span>
      </button>
    );
  }
  return (
    <select
      autoFocus
      value={value}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => {
        const next = e.target.value;
        setEditing(false);
        if (next !== value) onSave(next);
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
        }
      }}
      className="dialog-input"
      style={{ width: 'auto' }}
    >
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function NumberCell({
  value,
  onSave,
  format,
  min,
  max,
  step,
  align = 'left',
}: {
  value: number;
  onSave: (next: number) => void;
  format: (v: number) => string;
  min?: number;
  max?: number;
  step?: number;
  align?: 'left' | 'right';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const next = Number(draft);
    setEditing(false);
    if (Number.isFinite(next) && next !== value) {
      const clamped = Math.min(max ?? next, Math.max(min ?? next, next));
      onSave(clamped);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        className={cn('inline-edit-trigger tabular-nums', align === 'right' && 'text-right')}
        aria-label={`${format(value)}. Click to edit.`}
      >
        {format(value)}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
        }
      }}
      min={min}
      max={max}
      step={step}
      className={cn('dialog-input tabular-nums', align === 'right' && 'text-right')}
      style={{ width: 110 }}
    />
  );
}

function DateCell({
  value,
  onSave,
  format,
}: {
  value: string | null;
  onSave: (next: string | null) => void;
  format: (v: string | null) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const commit = (e: FocusEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    setEditing(false);
    const next = draft || null;
    if (next !== value) onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value ?? '');
          setEditing(true);
        }}
        className="inline-edit-trigger text-[var(--fg-secondary)]"
        aria-label={`Due ${format(value)}. Click to edit.`}
      >
        {format(value)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e);
        else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
        }
      }}
      className="dialog-input"
      style={{ width: 'auto' }}
    />
  );
}

// Self-ticking "updated 2m ago" badge. Wrapped in its own component so the
// schedule timer only re-renders this single span — not the entire row.
function UpdatedAgo({ iso }: { iso: string }) {
  const label = useLiveRelativeTime(iso);
  return (
    <>
      <span className="mx-1.5 text-[var(--fg-muted)]" aria-hidden>
        ·
      </span>
      <span title={new Date(iso).toLocaleString()}>{label}</span>
    </>
  );
}
