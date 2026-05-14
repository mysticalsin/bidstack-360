import { motion } from 'framer-motion';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { LeadPriorityBadge, LeadStatusBadge } from '@/components/lead/LeadStatusBadge';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { confirm } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
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

  const items = data?.items ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Leads</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
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
            Export CSV
          </Button>
          <Button onClick={() => nav('/leads/new')}>New lead</Button>
        </div>
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <input
            type="text"
            placeholder="Search leads…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[200px] flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
          />
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value === '' ? '' : LeadStatus.parse(e.target.value))
            }
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) =>
              setPriorityFilter(e.target.value === '' ? '' : LeadPriority.parse(e.target.value))
            }
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

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
        <Card>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--fg-tertiary)]">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
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
          </table>
        </Card>
      )}
    </div>
  );
}

function LeadRow({ lead, onDelete }: { lead: LeadSummary; onDelete: () => void }) {
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="group border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-hover)]"
    >
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
          onClick={onDelete}
          className="rounded-md px-2 py-1 text-xs text-[var(--fg-tertiary)] opacity-0 transition-opacity hover:bg-[var(--surface-hover)] hover:text-[var(--danger)] group-hover:opacity-100"
        >
          Delete
        </button>
      </td>
    </motion.tr>
  );
}
