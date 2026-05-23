import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { LeadPriorityBadge, LeadStatusBadge } from '@/components/lead/LeadStatusBadge';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { Button } from '@/components/ui/Button';
import { BulkActionBar } from '@/components/ui/BulkActionBar';
import { Card } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { SpotlightTable, SpotlightTableRow } from '@/components/ui/SpotlightTable';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { useDeleteLead, useLeads } from '@/hooks/useLeads';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import { LeadStatus, LeadPriority } from '@bidstack/shared';
import type { LeadSummary } from '@bidstack/shared';

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

export function LeadsPage() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<LeadPriority | ''>('');
  const { data, isLoading, isError, error, refetch } = useLeads({
    search: deferredSearch.trim() || undefined,
    status: statusFilter || undefined,
    priority: priorityFilter || undefined,
    limit: 50,
  });
  const del = useDeleteLead();

  const items = useMemo(() => data?.items ?? [], [data?.items]);
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
      <div className="page-header">
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
          <LiquidGlassButton onClick={() => nav('/leads/new')} size="sm">
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
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            />
          </label>
          <select
            aria-label="Filter leads by status"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value === '' ? '' : LeadStatus.parse(e.target.value))
            }
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
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
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
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
        <Card className="p-3">
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
                <th scope="col" className="px-4 py-3 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Company
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Priority
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Score
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Source
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
        </Card>
      )}
    </div>
  );
}

function LeadRow({
  lead,
  selected,
  query,
  onToggle,
  onDelete,
}: {
  lead: LeadSummary;
  selected: boolean;
  query: string;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <SpotlightTableRow
      query={query}
      searchableText={`${lead.firstName} ${lead.lastName} ${lead.email ?? ''} ${lead.companyName ?? ''} ${lead.status} ${lead.priority} ${lead.source ?? ''} ${lead.ownerName ?? ''}`}
      data-selected={selected}
      className="group"
    >
      <td className="px-4 py-3">
        <label className="table-checkbox-hit">
          <span className="sr-only">
            {selected
              ? `Deselect ${lead.firstName} ${lead.lastName}`
              : `Select ${lead.firstName} ${lead.lastName}`}
          </span>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="cursor-pointer accent-[var(--brand-primary)]"
          />
        </label>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/leads/${lead.id}`}
          className="font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
        >
          {lead.firstName} {lead.lastName}
        </Link>
        {lead.email && <div className="text-xs text-[var(--fg-tertiary)]">{lead.email}</div>}
      </td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">{lead.companyName ?? '—'}</td>
      <td className="px-4 py-3">
        <LeadStatusBadge status={lead.status} />
      </td>
      <td className="px-4 py-3">
        <LeadPriorityBadge priority={lead.priority} />
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-xs">{lead.score}</span>
      </td>
      <td className="px-4 py-3 text-[var(--fg-secondary)] capitalize">{lead.source}</td>
      <td className="px-4 py-3 text-[var(--fg-secondary)]">{lead.ownerName ?? '—'}</td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md px-2 py-1 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
          aria-label={`Delete ${lead.firstName} ${lead.lastName}`}
        >
          Delete
        </button>
      </td>
    </SpotlightTableRow>
  );
}
