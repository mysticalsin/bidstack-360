/**
 * audit-log/AuditLogFilters.tsx — search bar, date range, target-type, quick-filter
 * buttons, export controls, and active-filter chips for the AuditLog page.
 *
 * WHY a separate module: the filter bar is 180+ lines of controlled-input logic that
 * has no dependency on the table or insight panels — isolating it keeps each module
 * independently testable.
 */
import type { AuditLogEntry } from '@bidstack/shared';

import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

import type { ActiveFilterChip, DateRange, QuickFilter, TargetTypeFilter } from './audit-log-types';
import { DATE_RANGES, QUICK_FILTERS, TARGET_TYPES } from './audit-log-types';
import { exportCsv, writeClipboard } from './audit-log-helpers';

// ─── AuditFilterBar ───────────────────────────────────────────────────────────

export function AuditFilterBar({
  search,
  setSearch,
  range,
  setRange,
  targetType,
  setTargetType,
  quickFilter,
  setQuickFilter,
  rows,
  onClear,
  onRefresh,
  isRefreshing,
}: {
  search: string;
  setSearch: (value: string) => void;
  range: DateRange;
  setRange: (value: DateRange) => void;
  targetType: TargetTypeFilter;
  setTargetType: (value: TargetTypeFilter) => void;
  quickFilter: QuickFilter;
  setQuickFilter: (value: QuickFilter) => void;
  rows: AuditLogEntry[];
  onClear: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const activeFilters = [
    search ? { key: 'q', label: `Search: ${search}`, onRemove: () => setSearch('') } : undefined,
    range !== '7d'
      ? {
          key: 'range',
          label: `Range: ${DATE_RANGES.find((option) => option.value === range)?.label ?? range}`,
          onRemove: () => setRange('7d'),
        }
      : undefined,
    targetType !== 'all'
      ? {
          key: 'target',
          label: `Target: ${TARGET_TYPES.find((option) => option.value === targetType)?.label ?? targetType}`,
          onRemove: () => setTargetType('all'),
        }
      : undefined,
    quickFilter !== 'all'
      ? {
          key: 'category',
          label: `Category: ${QUICK_FILTERS.find((option) => option.value === quickFilter)?.label ?? quickFilter}`,
          onRemove: () => setQuickFilter('all'),
        }
      : undefined,
  ].filter((filter): filter is ActiveFilterChip => Boolean(filter));

  return (
    <Card
      role="search"
      aria-label="Audit log filters"
      className="space-y-4 border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_220px]">
        <label className="group relative block">
          <span className="sr-only">Search current audit page</span>
          <Icon
            name="search"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search current page by action, actor, target or diff..."
            className="h-11 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] pl-10 pr-4 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)] focus:ring-4 focus:ring-[var(--accent-primary)]/15"
          />
        </label>

        <label className="block">
          <span className="sr-only">Date range</span>
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as DateRange)}
            className="h-11 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 text-sm font-medium text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)] focus:ring-4 focus:ring-[var(--accent-primary)]/15"
          >
            {DATE_RANGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">Target type</span>
          <select
            value={targetType}
            onChange={(event) => setTargetType(event.target.value as TargetTypeFilter)}
            className="h-11 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 text-sm font-medium text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)] focus:ring-4 focus:ring-[var(--accent-primary)]/15"
          >
            {TARGET_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => exportCsv(rows)}
          disabled={rows.length === 0}
          className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-4 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-tertiary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="download" className="size-4" />
          Export visible
        </button>
        <button
          type="button"
          onClick={() => writeClipboard(window.location.href)}
          className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-4 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-tertiary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
        >
          <Icon name="link" className="size-4" />
          Copy view link
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-4 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-tertiary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15 disabled:cursor-wait disabled:opacity-60"
        >
          <Icon name="clock" className={cn('size-4', isRefreshing && 'animate-spin')} />
          {isRefreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Audit event category filters">
        {QUICK_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={quickFilter === option.value}
            onClick={() => setQuickFilter(option.value)}
            className={cn(
              'min-h-11 rounded-2xl border px-3 py-2 text-left transition focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15',
              quickFilter === option.value
                ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--text-primary)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]',
            )}
          >
            <span className="block text-sm font-semibold">{option.label}</span>
            <span className="block text-xs text-[var(--text-muted)]">{option.description}</span>
          </button>
        ))}
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Active view
          </span>
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={filter.onRemove}
              className="inline-flex min-h-8 items-center gap-1 rounded-full bg-[var(--surface-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-tertiary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
            >
              {filter.label}
              <Icon name="close" className="size-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="ml-auto inline-flex min-h-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] px-3 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-secondary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
          >
            Clear filters
          </button>
        </div>
      )}
    </Card>
  );
}
