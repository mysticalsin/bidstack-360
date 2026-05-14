// Twenty-style opportunities table with inline-editable stage, value,
// probability, and due date. Each row owns its own mutation hook so a
// PATCH on row N doesn't trigger renders on row M. Stage is a select cell
// (the most common field to edit during pipeline review); the rest are
// click-to-edit text/number/date.

import { motion } from 'framer-motion';
import { memo, useTransition, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { announceStageChange } from '@/components/a11y/useAnnouncer';
import { useConfetti } from '@/components/delight/useConfetti';
import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, stageTone } from '@/components/ui/Badge';
import { confirm } from '@/components/ui/ConfirmDialog';
import { SavedFlash } from '@/components/ui/SavedFlash';
import { SortableHeader } from '@/components/ui/SortableHeader';
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
import { formatDate, formatMoney, formatStage } from '@/lib/format';

import type { Opportunity, OpportunityStage } from '@bidstack/shared';

const STAGES: OpportunityStage[] = [
  'discovery',
  'qualified',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
];

export function OpportunitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') ?? undefined;
  const qc = useQueryClient();
  // useTransition: typing in the search box (handled at the parent above
  // via URL state) is urgent, but the table re-render is non-urgent.
  const [, startTransition] = useTransition();

  // Stage filter chips (Twenty-style quick filters)
  const stageFilterRaw = searchParams.get('stage');
  const stageFilter = STAGES.includes(stageFilterRaw as OpportunityStage)
    ? (stageFilterRaw as OpportunityStage)
    : null;
  const setStageFilter = (next: OpportunityStage | null) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('stage', next);
    else params.delete('stage');
    params.delete('search'); // clear search when switching stage filter
    setSearchParams(params, { replace: true });
  };

  const { data, isLoading, isError, error } = useOpportunities({
    limit: 100,
    ...(search ? { search } : {}),
    ...(stageFilter ? { stage: stageFilter } : {}),
  });

  // Sortable. Default sort = none (server returns by recent activity); the
  // user clicks a column header to override. Stage sorts by the canonical
  // funnel order rather than alphabetically — that's what users mean when
  // they sort by stage.
  const rawItems = useMemo(() => data?.items ?? [], [data?.items]);
  const accessors = useMemo(
    () => ({
      code: (o: Opportunity) => o.code,
      name: (o: Opportunity) => o.name,
      customer: (o: Opportunity) => o.customer,
      stage: (o: Opportunity) => STAGES.indexOf(o.stage),
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
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelectedIds((prev) => {
      if (items.every((o) => prev.has(o.id))) return new Set();
      return new Set(items.map((o) => o.id));
    });
  const clearSelection = () => setSelectedIds(new Set());
  const selectedOpps = useMemo(
    () => items.filter((o) => selectedIds.has(o.id)),
    [items, selectedIds],
  );

  const stageMove = useStageMutation();
  const bulkStageChange = async (stage: OpportunityStage) => {
    if (selectedOpps.length === 0) return;
    const snapshot = [...selectedOpps];
    let failed = 0;
    await Promise.all(
      snapshot.map((o) =>
        stageMove.mutateAsync({ id: o.id, stage }).catch(() => {
          failed += 1;
        }),
      ),
    );
    if (failed === 0) {
      toast.success(
        `Moved ${snapshot.length} opportunit${snapshot.length === 1 ? 'y' : 'ies'} to ${formatStage(stage)}`,
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
        stage: formatStage(opp.stage),
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
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">
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
                  className="ml-2 text-xs text-[var(--fg-tertiary)] underline hover:text-[var(--brand-primary)]"
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
                  className="ml-2 text-xs text-[var(--fg-tertiary)] underline hover:text-[var(--brand-primary)]"
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

      {/* Stage filter chips — Twenty-style quick filters */}
      {!search && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStageFilter(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !stageFilter
                ? 'bg-[var(--fg-primary)] text-[var(--surface-page)]'
                : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            All
          </button>
          {STAGES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStageFilter(stageFilter === s ? null : s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                stageFilter === s
                  ? 'bg-[var(--fg-primary)] text-[var(--surface-page)]'
                  : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {formatStage(s)}
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
                const next = e.target.value as OpportunityStage | '';
                if (next) {
                  void bulkStageChange(next);
                  e.target.value = '';
                }
              }}
              className="dialog-input"
            >
              <option value="">Move to stage…</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {formatStage(s)}
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
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {search
                ? `Opportunities matching "${search}"`
                : 'All opportunities, sorted by most recent activity. Cells are inline-editable.'}
            </caption>
            <thead className="sticky top-0 z-10 bg-[var(--surface-sunken)] text-xs text-[var(--fg-tertiary)] uppercase tracking-wider">
              <tr>
                <th scope="col" className="w-10 px-5 py-3">
                  <input
                    type="checkbox"
                    aria-label={allSelected ? 'Deselect all' : 'Select all'}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer accent-[var(--brand-primary)]"
                  />
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  <SortableHeader columnKey="code" state={sortState} onChange={setSortState}>
                    Code
                  </SortableHeader>
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  <SortableHeader columnKey="name" state={sortState} onChange={setSortState}>
                    Opportunity
                  </SortableHeader>
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  <SortableHeader columnKey="stage" state={sortState} onChange={setSortState}>
                    Stage
                  </SortableHeader>
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  <SortableHeader
                    columnKey="value"
                    state={sortState}
                    onChange={setSortState}
                    align="right"
                  >
                    Value
                  </SortableHeader>
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  <SortableHeader
                    columnKey="probability"
                    state={sortState}
                    onChange={setSortState}
                    align="right"
                  >
                    Probability
                  </SortableHeader>
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  <SortableHeader columnKey="dueDate" state={sortState} onChange={setSortState}>
                    Due
                  </SortableHeader>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {items.map((opp, i) => (
                <Row
                  key={opp.id}
                  opp={opp}
                  index={i}
                  isSelected={selectedIds.has(opp.id)}
                  onToggleSelect={toggleOne}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// One row. Owns its own usePatchOpportunity hook so a mutation on this row
// doesn't cascade through every other row in the table.
const Row = memo(function Row({
  opp,
  index,
  isSelected,
  onToggleSelect,
}: {
  opp: Opportunity;
  index: number;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const patch = usePatchOpportunity(opp.id);
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
    <motion.tr
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: 'spring',
        stiffness: 200,
        damping: 26,
        delay: Math.min(index, 16) * 0.028,
      }}
      className="group hover:bg-[var(--surface-sunken)] transition-colors"
      data-selected={isSelected ? 'true' : undefined}
      onMouseEnter={prefetch}
    >
      <td className="w-10 px-5 py-3">
        <input
          type="checkbox"
          aria-label={`Select ${opp.name}`}
          checked={isSelected}
          onChange={() => onToggleSelect(opp.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 cursor-pointer accent-[var(--brand-primary)]"
        />
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
        <StageCell
          value={opp.stage}
          onSave={(next) => {
            patch.mutate(
              { stage: next },
              {
                onSuccess: () => {
                  savedToast('Stage');
                  flash('stage');
                  // The "you won this one" moment — confetti only on
                  // closed_won, never on closed_lost (no celebration for
                  // a lost bid).
                  if (next === 'closed_won') {
                    fireConfetti();
                    toast.success(`🎉 Won "${opp.name}"!`, { duration: 5000 });
                  }
                  // Announce every stage move to screen readers — this is
                  // the most consequential edit on the page and the live
                  // region keeps SR users in sync.
                  announceStageChange(`${opp.name} moved to ${formatStage(next)}`);
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
              { value: next },
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
              { probability: next },
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
              { dueDate: next },
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
    </motion.tr>
  );
});

// ── Inline-edit cells ────────────────────────────────────────────────────

function StageCell({
  value,
  onSave,
}: {
  value: OpportunityStage;
  onSave: (next: OpportunityStage) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-edit-trigger"
        aria-label={`Stage: ${formatStage(value)}. Click to change.`}
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
          <Badge tone={stageTone(value)}>{formatStage(value)}</Badge>
        </motion.span>
      </button>
    );
  }
  return (
    <select
      autoFocus
      value={value}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => {
        const next = e.target.value as OpportunityStage;
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
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {formatStage(s)}
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
