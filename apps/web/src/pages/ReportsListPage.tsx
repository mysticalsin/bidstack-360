// ReportsListPage — /reports (analytics reports)
// Table of saved reports with: name, owner, last run, schedule, actions.
// NOTE: This replaces/augments the legacy ReportsPage which served pipeline stats.
// The legacy page is preserved at its import path; this is the new analytics entry.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  Play,
  Edit2,
  Copy,
  Trash2,
  Clock,
  Calendar,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';

import { cn } from '@/lib/cn';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import {
  useAnalyticsReportsList,
  useRunReport,
  useDuplicateReport,
  useDeleteReport,
  type Report,
} from '@/hooks/useAnalyticsReports';

type SortKey = 'name' | 'lastRunAt' | 'createdAt';

export function ReportsListPage() {
  const { data: reports = [], isLoading, error } = useAnalyticsReportsList();
  const runMutation = useRunReport();
  const duplicateMutation = useDuplicateReport();
  const deleteMutation = useDeleteReport();

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleRun = async (r: Report) => {
    setRunningIds((s) => new Set(s).add(r.id));
    try {
      await runMutation.mutateAsync({ id: r.id });
    } finally {
      setRunningIds((s) => {
        const next = new Set(s);
        next.delete(r.id);
        return next;
      });
    }
  };

  const filtered = reports
    .filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aVal = String(a[sortKey as keyof Report] ?? '');
      const bVal = String(b[sortKey as keyof Report] ?? '');
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });

  if (isLoading) {
    return (
      <div className="p-8 space-y-3">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-14 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState title="Failed to load reports" message={(error as Error).message} />
      </div>
    );
  }

  const renderSortIcon = (k: SortKey) =>
    sortKey === k ? (
      sortDir === 'asc' ? (
        <ChevronUp size={12} className="inline" />
      ) : (
        <ChevronDown size={12} className="inline" />
      )
    ) : null;

  const thCls =
    'px-3 py-2.5 text-left text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wide cursor-pointer select-none hover:text-[var(--fg-primary)] transition-colors';

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Reports</h1>
          <p className="text-sm text-[var(--fg-tertiary)] mt-0.5">
            {reports.length} saved report{reports.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          to="/reports/new"
          data-tour="reports-new"
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white',
            'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] transition-colors',
            'min-h-[44px]',
          )}
        >
          <Plus size={16} />
          New report
        </Link>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reports…"
          aria-label="Search reports"
          className={cn(
            'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]',
            'pl-9 pr-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]',
            'focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]',
            'min-h-[44px]',
          )}
        />
      </div>

      {/* sr-only live region — announces search result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading &&
          `${filtered.length} report${filtered.length === 1 ? '' : 's'}${search ? ` matching "${search}"` : ''}`}
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          title="No reports found"
          message={search ? 'Try a different search.' : 'Create your first analytical report.'}
          action={
            !search ? (
              <Link
                to="/reports/new"
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white',
                  'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] min-h-[44px]',
                )}
              >
                <Plus size={16} />
                New report
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
          <table className="w-full" role="grid" aria-label="Reports">
            <thead className="bg-[var(--surface-sunken)]">
              <tr>
                <th
                  className={thCls}
                  onClick={() => handleSort('name')}
                  aria-sort={
                    sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  Name {renderSortIcon('name')}
                </th>
                <th className={thCls}>Entity</th>
                <th
                  className={thCls}
                  onClick={() => handleSort('lastRunAt')}
                  aria-sort={
                    sortKey === 'lastRunAt'
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  Last run {renderSortIcon('lastRunAt')}
                </th>
                <th className={thCls}>Schedule</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-[var(--fg-secondary)] uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className={cn(
                    'border-t border-[var(--border-subtle)]',
                    i % 2 === 0 ? 'bg-[var(--surface-card)]' : 'bg-[var(--surface-sunken)]',
                  )}
                >
                  <td className="px-3 py-3">
                    <Link
                      to={`/reports/${r.id}/edit`}
                      className="text-sm font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)] transition-colors"
                    >
                      {r.name}
                    </Link>
                    {r.description && (
                      <p className="text-xs text-[var(--fg-tertiary)] truncate max-w-[240px] mt-0.5">
                        {r.description}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-[var(--fg-secondary)] capitalize">
                      {r.query.entity}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-[var(--fg-tertiary)]">
                    {r.lastRunAt ? (
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {new Date(r.lastRunAt).toLocaleDateString()}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-[var(--fg-tertiary)]">
                    {r.schedule ? (
                      <span className="flex items-center gap-1 text-[var(--success)]">
                        <Calendar size={11} />
                        {r.schedule}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* Run */}
                      <button
                        onClick={() => handleRun(r)}
                        disabled={runningIds.has(r.id)}
                        aria-label={`Run report ${r.name}`}
                        className={cn(
                          'flex items-center justify-center w-8 h-8 rounded-lg transition-colors min-w-[44px] min-h-[44px]',
                          'text-[var(--fg-tertiary)] hover:text-[var(--success)] hover:bg-[var(--success-tint)]',
                          'disabled:opacity-50',
                        )}
                      >
                        <Play size={13} />
                      </button>
                      {/* Edit */}
                      <Link
                        to={`/reports/${r.id}/edit`}
                        aria-label={`Edit report ${r.name}`}
                        className={cn(
                          'flex items-center justify-center w-8 h-8 rounded-lg transition-colors min-w-[44px] min-h-[44px]',
                          'text-[var(--fg-tertiary)] hover:text-[var(--brand-primary)] hover:bg-[var(--brand-primary-tint)]',
                        )}
                      >
                        <Edit2 size={13} />
                      </Link>
                      {/* Duplicate */}
                      <button
                        onClick={() => duplicateMutation.mutate(r.id)}
                        aria-label={`Duplicate report ${r.name}`}
                        className={cn(
                          'flex items-center justify-center w-8 h-8 rounded-lg transition-colors min-w-[44px] min-h-[44px]',
                          'text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] hover:bg-[var(--surface-sunken)]',
                        )}
                      >
                        <Copy size={13} />
                      </button>
                      {/* Delete */}
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${r.name}"?`)) deleteMutation.mutate(r.id);
                        }}
                        aria-label={`Delete report ${r.name}`}
                        className={cn(
                          'flex items-center justify-center w-8 h-8 rounded-lg transition-colors min-w-[44px] min-h-[44px]',
                          'text-[var(--fg-tertiary)] hover:text-[var(--danger)] hover:bg-[var(--danger-tint)]',
                        )}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
