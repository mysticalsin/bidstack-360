import { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { Button } from '@/components/ui/Button';
import { BulkActionBar } from '@/components/ui/BulkActionBar';
import { Card } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { SpotlightTable } from '@/components/ui/SpotlightTable';
import { SortableHeader, getSortableHeaderAriaSort } from '@/components/ui/SortableHeader';
import type { SortState } from '@/components/ui/SortableHeader';
import { useTableSort } from '@/hooks/useTableSort';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useDeleteLead, useLeads, useUpdateLeadById } from '@/hooks/useLeads';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import { LeadStatus, LeadPriority } from '@bidstack/shared';
import { LeadRow } from './leadsPage/LeadRow';

const STATUS_OPTIONS: { value: LeadStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'nurture', label: 'Nurture' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'converted', label: 'Converted' },
];

const PRIORITY_OPTIONS: { value: LeadPriority | ''; label: string }[] = [
  { value: '', label: 'All priorities' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

// Module scope so the sort accessor stays referentially stable (low<…<critical
// ordering, not alphabetical, when sorting by priority).
const PRIORITY_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function LeadsPage() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<LeadPriority | ''>('');
  const [searchParams, setSearchParams] = useSearchParams();
  const pager = useCursorPagination(`${deferredSearch}|${statusFilter}|${priorityFilter}`);
  const { data, isLoading, isError, error, refetch } = useLeads({
    search: deferredSearch.trim() || undefined,
    status: statusFilter || undefined,
    priority: priorityFilter || undefined,
    limit: 50,
    ...(pager.cursor ? { cursor: pager.cursor } : {}),
  });
  const del = useDeleteLead();
  // A2 — inline cell editing (Twenty pattern). One mutation instance fans
  // across the whole table via optimistic updates keyed to lead id.
  const updateLead = useUpdateLeadById();

  const rawItems = useMemo(() => data?.items ?? [], [data?.items]);

  // Column sorting (parity with Opportunities/Contacts). Sorts the current page
  // client-side; URL-persisted so a sorted view is shareable/back-navigable.
  type LeadItem = (typeof rawItems)[number];
  type LeadSortKey = 'name' | 'companyName' | 'status' | 'priority' | 'score' | 'source';
  const accessors = useMemo(
    (): Record<LeadSortKey, (l: LeadItem) => string | number | null> => ({
      name: (l) => `${l.firstName} ${l.lastName}`.trim(),
      companyName: (l) => l.companyName,
      status: (l) => l.status,
      priority: (l) => PRIORITY_ORDER[l.priority] ?? 0,
      score: (l) => l.score,
      source: (l) => l.source,
    }),
    // PRIORITY_ORDER is a module-scope constant (stable) — no deps needed.
    [],
  );
  const parseSortParam = (raw: string | null): SortState<LeadSortKey> => {
    if (!raw) return { key: null, dir: null };
    const [k, d] = raw.split('.');
    if (!k || !(k in accessors) || (d !== 'asc' && d !== 'desc')) return { key: null, dir: null };
    return { key: k as LeadSortKey, dir: d };
  };
  const sortState = parseSortParam(searchParams.get('sort'));
  const setSortState = (next: SortState<LeadSortKey>) => {
    const params = new URLSearchParams(searchParams);
    if (!next.key || !next.dir) params.delete('sort');
    else params.set('sort', `${next.key}.${next.dir}`);
    setSearchParams(params, { replace: true });
  };
  const { sorted } = useTableSort(rawItems, accessors, {
    state: sortState,
    onChange: setSortState,
  });
  // useTableSort returns ReadonlyArray; downstream consumers (bulk selection,
  // stats) take a mutable array. `sorted` is memoized so this keeps a stable
  // identity — we never mutate it.
  const items = sorted as LeadItem[];
  const bulk = useBulkSelection(items);
  const leadStats = useMemo(() => {
    const total = items.length;
    const priorityLeads = items.filter(
      (lead) => lead.priority === 'high' || lead.priority === 'critical',
    ).length;
    const pipelineReady = items.filter(
      (lead) => lead.status === 'qualified' || lead.status === 'converted',
    ).length;
    const averageScore =
      total === 0
        ? '0'
        : Math.round(items.reduce((sum, lead) => sum + lead.score, 0) / total).toLocaleString();

    return [
      { label: 'Filtered leads', value: total.toLocaleString(), detail: 'current view' },
      {
        label: 'High priority',
        value: `${priorityLeads}/${total || 0}`,
        detail: 'high or critical',
      },
      {
        label: 'Pipeline-ready',
        value: pipelineReady.toLocaleString(),
        detail: 'qualified or converted',
      },
      { label: 'Avg score', value: averageScore, detail: 'fit score' },
    ];
  }, [items]);

  const exportSelected = () => {
    if (bulk.selectedItems.length === 0) {
      toast.info('Nothing to export');
      return;
    }
    const csv = rowsToCsv(
      bulk.selectedItems.map((l) => ({
        name: `${l.firstName} ${l.lastName}`,
        company: l.companyName ?? '',
        email: l.email ?? '',
        status: l.status,
        priority: l.priority,
        score: l.score.toString(),
        source: l.source ?? '',
        createdAt: l.createdAt.slice(0, 10),
      })),
      [
        { key: 'name', label: 'Name' },
        { key: 'company', label: 'Company' },
        { key: 'email', label: 'Email' },
        { key: 'status', label: 'Status' },
        { key: 'priority', label: 'Priority' },
        { key: 'score', label: 'Score' },
        { key: 'source', label: 'Source' },
        { key: 'createdAt', label: 'Created' },
      ],
    );
    downloadCsv(`bidstack-leads-${new Date().toISOString().slice(0, 10)}`, csv);
    toast.success(
      `Exported ${bulk.selectedItems.length} lead${bulk.selectedItems.length === 1 ? '' : 's'}`,
    );
  };

  const bulkDelete = async () => {
    if (bulk.selectedItems.length === 0) return;
    const ok = await confirm({
      title: `Delete ${bulk.selectedItems.length} lead${bulk.selectedItems.length === 1 ? '' : 's'}?`,
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    let failed = 0;
    await Promise.all(
      bulk.selectedItems.map((l) =>
        del.mutateAsync(l.id).catch(() => {
          failed += 1;
        }),
      ),
    );
    bulk.clear();
    if (failed === 0) {
      toast.success(
        `Deleted ${bulk.selectedItems.length} lead${bulk.selectedItems.length === 1 ? '' : 's'}`,
      );
    } else {
      toast.error(`${failed} deletion${failed === 1 ? '' : 's'} failed`);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Leads</h1>
        <div className="flex items-center gap-2">
          <LiquidGlassButton
            tone="secondary"
            size="sm"
            onClick={() => {
              if (items.length === 0) {
                toast.info('Nothing to export');
                return;
              }
              const csv = rowsToCsv(
                items.map((l) => ({
                  name: `${l.firstName} ${l.lastName}`,
                  company: l.companyName ?? '',
                  title: l.title ?? '',
                  status: l.status,
                  score: l.score,
                  source: l.source ?? '',
                  createdAt: l.createdAt.slice(0, 10),
                })),
                [
                  { key: 'name', label: 'Name' },
                  { key: 'company', label: 'Company' },
                  { key: 'title', label: 'Title' },
                  { key: 'status', label: 'Status' },
                  { key: 'score', label: 'Score (0-10000)' },
                  { key: 'source', label: 'Source' },
                  { key: 'createdAt', label: 'Created' },
                ],
              );
              downloadCsv(`bidstack-leads-${new Date().toISOString().slice(0, 10)}`, csv);
              toast.success(`Exported ${items.length} lead${items.length === 1 ? '' : 's'}`);
            }}
            disabled={items.length === 0}
          >
            <Icon name="download" size={14} />
            Export CSV
          </LiquidGlassButton>
          <LiquidGlassButton onClick={() => nav('/leads/new')} size="sm" data-tour="leads-page-add">
            <Icon name="plus" size={14} />
            New lead
          </LiquidGlassButton>
        </div>
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <label className="min-w-[200px] flex-1">
            <span className="sr-only">Search leads</span>
            <input
              type="text"
              aria-label="Search leads"
              placeholder="Search leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] min-h-[44px] dark:bg-[var(--surface-glass)] dark:backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-page)] focus:border-[var(--brand-primary)]"
            />
          </label>
          <select
            aria-label="Filter leads by status"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value === '' ? '' : LeadStatus.parse(e.target.value))
            }
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] min-h-[44px] dark:bg-[var(--surface-glass)] dark:backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-page)] focus:border-[var(--brand-primary)]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter leads by priority"
            value={priorityFilter}
            onChange={(e) =>
              setPriorityFilter(e.target.value === '' ? '' : LeadPriority.parse(e.target.value))
            }
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] min-h-[44px] dark:bg-[var(--surface-glass)] dark:backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-page)] focus:border-[var(--brand-primary)]"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {!isLoading && !isError ? (
        <section
          className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Lead list summary"
        >
          {leadStats.map((stat) => (
            <Card key={stat.label} className="px-3 py-2">
              <span className="text-xs font-medium text-[var(--fg-tertiary)]">{stat.label}</span>
              <strong className="mt-1 block text-lg font-semibold tabular-nums text-[var(--fg-primary)]">
                {stat.value}
              </strong>
              <span className="text-xs text-[var(--fg-tertiary)]">{stat.detail}</span>
            </Card>
          ))}
        </section>
      ) : null}

      {/* sr-only live region — announces filter/search result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading && !isError
          ? `${items.length} lead${items.length === 1 ? '' : 's'}${deferredSearch ? ` matching "${deferredSearch}"` : ''}`
          : ''}
      </p>

      <BulkActionBar
        count={bulk.count}
        onExport={exportSelected}
        onDelete={bulkDelete}
        onClear={bulk.clear}
        isDeleting={del.isPending}
      />

      {isError ? (
        <ErrorState
          title="Failed to load leads"
          message={error?.message ?? 'Something went wrong'}
          action={<Button onClick={() => refetch()}>Retry</Button>}
        />
      ) : isLoading ? (
        <TableSkeleton rows={8} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No leads yet"
          message="Create your first lead to start tracking prospects."
          action={<Button onClick={() => nav('/leads/new')}>New lead</Button>}
        />
      ) : (
        <Card className="min-w-0 overflow-hidden p-3">
          <SpotlightTable
            query={deferredSearch}
            minWidth={900}
            className="[&_tr[data-selected=true]]:bg-[var(--brand-primary-tint)]/60"
          >
            <thead>
              <tr>
                <th className="w-10">
                  <label className="table-checkbox-hit">
                    <span className="sr-only">
                      {bulk.allSelected ? 'Deselect all' : 'Select all'}
                    </span>
                    <input
                      type="checkbox"
                      checked={bulk.allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = bulk.someSelected;
                      }}
                      onChange={() => bulk.toggleAll(items)}
                      className="cursor-pointer accent-[var(--brand-primary)]"
                    />
                  </label>
                </th>
                <th scope="col" className="px-4 py-3 font-medium" aria-sort={getSortableHeaderAriaSort('name', sortState)}>
                  <SortableHeader columnKey="name" state={sortState} onChange={setSortState}>
                    Name
                  </SortableHeader>
                </th>
                <th scope="col" className="px-4 py-3 font-medium" aria-sort={getSortableHeaderAriaSort('companyName', sortState)}>
                  <SortableHeader columnKey="companyName" state={sortState} onChange={setSortState}>
                    Company
                  </SortableHeader>
                </th>
                <th scope="col" className="px-4 py-3 font-medium" aria-sort={getSortableHeaderAriaSort('status', sortState)}>
                  <SortableHeader columnKey="status" state={sortState} onChange={setSortState}>
                    Status
                  </SortableHeader>
                </th>
                <th scope="col" className="px-4 py-3 font-medium" aria-sort={getSortableHeaderAriaSort('priority', sortState)}>
                  <SortableHeader columnKey="priority" state={sortState} onChange={setSortState}>
                    Priority
                  </SortableHeader>
                </th>
                <th scope="col" className="px-4 py-3 font-medium" aria-sort={getSortableHeaderAriaSort('score', sortState)}>
                  <SortableHeader columnKey="score" state={sortState} onChange={setSortState}>
                    Score
                  </SortableHeader>
                </th>
                <th scope="col" className="px-4 py-3 font-medium" aria-sort={getSortableHeaderAriaSort('source', sortState)}>
                  <SortableHeader columnKey="source" state={sortState} onChange={setSortState}>
                    Source
                  </SortableHeader>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Owner
                </th>
                <th scope="col" className="px-4 py-3 font-medium text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  selected={bulk.isSelected(lead.id)}
                  query={deferredSearch}
                  onToggle={() => bulk.toggleOne(lead.id)}
                  onPatch={(patch) => updateLead.mutate({ id: lead.id, patch })}
                  onDelete={async () => {
                    const ok = await confirm({
                      title: 'Delete lead?',
                      description: `This will permanently remove ${lead.firstName} ${lead.lastName} from your leads.`,
                      confirmLabel: 'Delete',
                      destructive: true,
                    });
                    if (!ok) return;
                    del.mutate(lead.id, {
                      onSuccess: () => toast.success('Lead deleted'),
                      onError: () => toast.error('Failed to delete lead'),
                    });
                  }}
                />
              ))}
            </tbody>
          </SpotlightTable>
          <CursorPager
            currentPage={pager.page}
            hasNext={Boolean(data?.nextCursor)}
            hasPrevious={pager.hasPrevious}
            isLoading={isLoading}
            itemCount={items.length}
            label="leads"
            onNext={() => pager.goNext(data?.nextCursor)}
            onPrevious={pager.goPrevious}
          />
        </Card>
      )}
    </div>
  );
}
