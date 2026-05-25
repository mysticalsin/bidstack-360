import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { AuditLogEntry } from '@bidstack/shared';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

type DateRange = '24h' | '7d' | '30d' | 'all';

type TargetTypeFilter =
  | 'all'
  | 'opportunity'
  | 'company'
  | 'contact'
  | 'lead'
  | 'task'
  | 'invoice'
  | 'api_key'
  | 'agent'
  | 'webhook'
  | 'file';

type QuickFilter = 'all' | 'security' | 'destructive' | 'crm' | 'system';

interface DateRangeOption {
  value: DateRange;
  label: string;
}

interface TargetTypeOption {
  value: TargetTypeFilter;
  label: string;
}

interface QuickFilterOption {
  value: QuickFilter;
  label: string;
  description: string;
}

interface AuditClassification {
  category: QuickFilter;
  label: string;
  tone: BadgeTone;
  railClass: string;
}

interface ActiveFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

const DATE_RANGES: DateRangeOption[] = [
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

const TARGET_TYPES: TargetTypeOption[] = [
  { value: 'all', label: 'All records' },
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'company', label: 'Companies' },
  { value: 'contact', label: 'Contacts' },
  { value: 'lead', label: 'Leads' },
  { value: 'task', label: 'Tasks' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'api_key', label: 'API keys' },
  { value: 'agent', label: 'Agents' },
  { value: 'webhook', label: 'Webhooks' },
  { value: 'file', label: 'Files' },
];

const QUICK_FILTERS: QuickFilterOption[] = [
  { value: 'all', label: 'All', description: 'Every event in the selected range' },
  { value: 'security', label: 'Security', description: 'Keys, permissions, auth, MCP and webhooks' },
  { value: 'destructive', label: 'Destructive', description: 'Deletes, revokes, cancellations and removals' },
  { value: 'crm', label: 'CRM changes', description: 'Account, contact, lead and opportunity updates' },
  { value: 'system', label: 'System', description: 'Worker, import, sync and automation events' },
];

const CRM_TARGETS = new Set([
  'account',
  'company',
  'contact',
  'lead',
  'opportunity',
  'pipeline',
  'quote',
  'invoice',
  'task',
  'territory',
  'service_desk',
]);

const SECURITY_TERMS = [
  'api_key',
  'apikey',
  'mcp',
  'webhook',
  'permission',
  'role',
  'auth',
  'login',
  'token',
  'secret',
  'agent',
  'integration',
];

const DESTRUCTIVE_TERMS = ['delete', 'remove', 'revoke', 'cancel', 'disable', 'void', 'archive'];
const SYSTEM_TERMS = ['worker', 'sync', 'import', 'export', 'job', 'queue', 'automation', 'system'];

const EVENT_LIMIT = 200;
const EMPTY_AUDIT_ROWS: AuditLogEntry[] = [];

export function AuditLogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const search = searchParams.get('q') ?? '';
  const range = parseDateRange(searchParams.get('range'));
  const targetType = parseTargetType(searchParams.get('target'));
  const quickFilter = parseQuickFilter(searchParams.get('category'));
  const cursor = cursorStack.at(-1);
  const since = useMemo(() => getSince(range), [range]);

  const filter = useMemo(
    () => ({
      limit: EVENT_LIMIT,
      ...(cursor ? { cursor } : {}),
      ...(since ? { since } : {}),
      ...(targetType !== 'all' ? { targetType } : {}),
    }),
    [cursor, since, targetType],
  );

  const query = useAuditLogs(filter);
  const rows = query.data?.items ?? EMPTY_AUDIT_ROWS;
  const visibleRows = useMemo(
    () => rows.filter((row) => rowMatchesQuickFilter(row, quickFilter)).filter((row) => rowMatchesSearch(row, search)),
    [quickFilter, rows, search],
  );
  const stats = useMemo(() => buildStats(rows), [rows]);

  const resetEvidencePage = () => {
    setCursorStack([]);
    setExpanded({});
  };
  const updateFilterParams = (patch: Partial<Record<'q' | 'range' | 'target' | 'category', string | undefined>>, replace = true) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    setSearchParams(next, { replace });
  };
  const clearFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: false });
    resetEvidencePage();
  };

  return (
    <div className="space-y-5 px-6 pb-10 pt-6">
      <AuditHero
        stats={stats}
        totalVisible={visibleRows.length}
        page={cursorStack.length + 1}
        isLoading={query.isLoading || query.isFetching}
        lastRefreshedAt={query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : undefined}
      />

      <AuditFilterBar
        search={search}
        setSearch={(value) => updateFilterParams({ q: value.trim() ? value : undefined })}
        range={range}
        setRange={(value) => {
          updateFilterParams({ range: value === '7d' ? undefined : value }, false);
          resetEvidencePage();
        }}
        targetType={targetType}
        setTargetType={(value) => {
          updateFilterParams({ target: value === 'all' ? undefined : value }, false);
          resetEvidencePage();
        }}
        quickFilter={quickFilter}
        setQuickFilter={(value) => updateFilterParams({ category: value === 'all' ? undefined : value })}
        rows={visibleRows}
        onClear={clearFilters}
        onRefresh={() => {
          void query.refetch();
        }}
        isRefreshing={query.isFetching}
      />

      <AuditInsightStrip rows={visibleRows} />

      {query.isLoading && <LoadingSkeleton rows={8} />}
      {query.error && (
        <ErrorState title="Failed to load audit entries" message={String(query.error)} />
      )}
      {!query.isLoading && rows.length === 0 && (
        <EmptyState title="No audit entries" message="No audit entries match this range." />
      )}

      {query.data && (
        <AuditTable
          rows={visibleRows}
          rawRowCount={rows.length}
          expanded={expanded}
          onToggle={(id) => setExpanded((current) => ({ ...current, [id]: !current[id] }))}
          canGoNewer={cursorStack.length > 0}
          canGoOlder={Boolean(query.data.nextCursor)}
          page={cursorStack.length + 1}
          onOlder={() => {
            if (query.data?.nextCursor) {
              setCursorStack((current) => [...current, query.data.nextCursor as string]);
              setExpanded({});
            }
          }}
          onNewer={() => {
            setCursorStack((current) => current.slice(0, -1));
            setExpanded({});
          }}
        />
      )}
    </div>
  );
}

function AuditHero({
  stats,
  totalVisible,
  page,
  isLoading,
  lastRefreshedAt,
}: {
  stats: ReturnType<typeof buildStats>;
  totalVisible: number;
  page: number;
  isLoading: boolean;
  lastRefreshedAt?: string;
}) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-6 shadow-[var(--shadow-soft)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-primary)]/40 to-transparent" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">Governance console</Badge>
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">Read-only evidence trail</span>
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">Audit Log</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              Review security, agent, workflow and CRM mutations with enough context to explain who changed what, when it
              happened and where to investigate next.
            </p>
          </div>
        </div>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="flex min-w-fit items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)]"
        >
          <span className="size-2 rounded-full bg-[var(--tag-jade-fg)] shadow-[0_0_0_4px_var(--tag-jade-bg)]" />
          {isLoading
            ? 'Refreshing evidence...'
            : `${totalVisible} visible on page ${page}${lastRefreshedAt ? ` · refreshed ${relativeTime(lastRefreshedAt)}` : ''}`}
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <AuditMetricCard icon="reports" label="Events loaded" value={<AnimatedMetric value={String(stats.total)} />} tone="blue" helper="Current server page" />
        <AuditMetricCard icon="shield" label="Security/API" value={<AnimatedMetric value={String(stats.security)} />} tone="purple" helper="Keys, MCP, auth, webhooks" />
        <AuditMetricCard icon="warning" label="Destructive" value={<AnimatedMetric value={String(stats.destructive)} />} tone="tomato" helper="Deletes, revokes, cancels" />
        <AuditMetricCard icon="building" label="CRM changes" value={<AnimatedMetric value={String(stats.crm)} />} tone="teal" helper="Revenue record edits" />
        <AuditMetricCard
          icon="clock"
          label="Latest event"
          value={stats.latest ? relativeTime(stats.latest) : 'None'}
          tone="jade"
          helper={stats.latest ? formatAbsolute(stats.latest) : 'No events in range'}
        />
      </div>
    </section>
  );
}

function AuditMetricCard({
  icon,
  label,
  value,
  tone,
  helper,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  tone: BadgeTone;
  helper: string;
}) {
  return (
    <Card className="min-h-[128px] border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</span>
          <span className="grid size-9 place-items-center rounded-2xl bg-[var(--surface-primary)] text-[var(--text-secondary)]">
            <Icon name={icon} className="size-4" />
          </span>
        </div>
        <div>
          <div className="text-2xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">{value}</div>
          <Badge tone={tone} className="mt-2">
            {helper}
          </Badge>
        </div>
      </div>
    </Card>
  );
}

function AuditInsightStrip({ rows }: { rows: AuditLogEntry[] }) {
  const buckets = useMemo(() => buildActivityBuckets(rows), [rows]);
  const stats = useMemo(() => buildStats(rows), [rows]);
  const evidenceHealth = useMemo(() => buildEvidenceHealth(rows), [rows]);
  const topActor = useMemo(() => mostFrequent(rows.map(actorLabel).filter(Boolean)), [rows]);
  const topTarget = useMemo(() => mostFrequent(rows.map((row) => row.targetType ?? 'system').filter(Boolean)), [rows]);
  const maxBucket = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const riskTotal = stats.security + stats.destructive;
  const riskRatio = rows.length === 0 ? 0 : Math.round((riskTotal / rows.length) * 100);

  return (
    <section className="grid gap-3 xl:grid-cols-[1.35fr_0.95fr_0.95fr]">
      <Card className="border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Activity cadence</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Real event volume from the currently loaded evidence page.</p>
          </div>
          <Badge tone={riskRatio >= 25 ? 'tomato' : riskRatio >= 10 ? 'amber' : 'jade'}>{riskRatio}% attention events</Badge>
        </div>
        <div className="mt-5 flex h-28 items-end gap-1.5" aria-label="Audit event volume chart">
          {buckets.map((bucket) => {
            const height = bucket.count === 0 ? 8 : Math.max(14, Math.round((bucket.count / maxBucket) * 100));
            return (
              <div key={bucket.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <div className="flex h-24 w-full items-end">
                  <div
                    className={cn(
                      'w-full rounded-t-lg transition-[height,background-color] duration-300',
                      bucket.destructive > 0
                        ? 'bg-[var(--tag-tomato-fg)]'
                        : bucket.security > 0
                          ? 'bg-[var(--tag-purple-fg)]'
                          : 'bg-[var(--accent-primary)]/70',
                    )}
                    style={{ height: `${height}%` }}
                    title={`${bucket.label}: ${bucket.count} events`}
                  />
                </div>
                <span className="max-w-full truncate text-[10px] font-medium text-[var(--text-muted)]">{bucket.label}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Forensic watchlist</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Fast triage from the loaded evidence set.</p>
          </div>
          <span className="grid size-9 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
            <Icon name="shield" className="size-4" />
          </span>
        </div>
        <dl className="mt-4 grid gap-3">
          <AuditWatchItem label="Top actor" value={topActor?.value ?? 'None'} detail={topActor ? `${topActor.count} events` : 'No loaded events'} />
          <AuditWatchItem label="Hottest target" value={humanizeKey(topTarget?.value ?? 'None')} detail={topTarget ? `${topTarget.count} events` : 'No loaded events'} />
          <AuditWatchItem label="Review queue" value={`${riskTotal} attention events`} detail={`${stats.destructive} destructive, ${stats.security} security/API`} />
        </dl>
      </Card>

      <EvidenceHealthCard health={evidenceHealth} />
    </section>
  );
}

function EvidenceHealthCard({ health }: { health: ReturnType<typeof buildEvidenceHealth> }) {
  return (
    <Card className="border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Evidence quality</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Coverage signals that make audits defensible.</p>
        </div>
        <Badge tone={health.score >= 85 ? 'jade' : health.score >= 65 ? 'amber' : 'tomato'}>
          {health.score}/100
        </Badge>
      </div>
      <dl className="mt-4 grid gap-3">
        <EvidenceHealthRow label="Structured diffs" value={health.diffPct} detail={`${health.withDiff}/${health.total} events`} />
        <EvidenceHealthRow label="Target references" value={health.targetPct} detail={`${health.withTarget}/${health.total} linked`} />
        <EvidenceHealthRow label="Actor attribution" value={health.actorPct} detail={`${health.withActor}/${health.total} attributed`} />
      </dl>
    </Card>
  );
}

function EvidenceHealthRow({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</dt>
        <dd className="text-xs font-semibold text-[var(--text-secondary)]">{detail}</dd>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-secondary)]" aria-label={`${label}: ${value}%`}>
        <div className="h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-500" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function AuditWatchItem({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2.5">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-end justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">{value}</span>
        <span className="text-xs text-[var(--text-secondary)]">{detail}</span>
      </dd>
    </div>
  );
}

function AuditFilterBar({
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
    <Card role="search" aria-label="Audit log filters" className="space-y-4 border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_220px]">
        <label className="group relative block">
          <span className="sr-only">Search current audit page</span>
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" />
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
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Active view</span>
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

function AuditTable({
  rows,
  rawRowCount,
  expanded,
  onToggle,
  canGoNewer,
  canGoOlder,
  page,
  onOlder,
  onNewer,
}: {
  rows: AuditLogEntry[];
  rawRowCount: number;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  canGoNewer: boolean;
  canGoOlder: boolean;
  page: number;
  onOlder: () => void;
  onNewer: () => void;
}) {
  return (
    <Card className="overflow-hidden border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Evidence stream</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Showing {rows.length} filtered events from {rawRowCount} loaded records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNewer}
            disabled={!canGoNewer}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-secondary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Newer
          </button>
          <span className="rounded-xl bg-[var(--surface-secondary)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">Page {page}</span>
          <button
            type="button"
            onClick={onOlder}
            disabled={!canGoOlder}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-secondary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Older
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="grid min-h-[260px] place-items-center px-6 py-12 text-center">
          <div className="max-w-sm">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
              <Icon name="search" className="size-5" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">No matching evidence</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Adjust the category, record type or search terms to widen the audit trail.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto" role="region" aria-label="Audit evidence table" tabIndex={0}>
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <caption className="sr-only">Audit log entries, newest first</caption>
            <thead className="sticky top-0 z-10 bg-[var(--surface-secondary)] text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Event</th>
                <th scope="col" className="px-4 py-3 font-semibold">Actor</th>
                <th scope="col" className="px-4 py-3 font-semibold">Target</th>
                <th scope="col" className="px-4 py-3 font-semibold">Time</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AuditRow key={row.id} row={row} isOpen={Boolean(expanded[row.id])} onToggle={() => onToggle(row.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AuditRow({ row, isOpen, onToggle }: { row: AuditLogEntry; isOpen: boolean; onToggle: () => void }) {
  const classification = classifyAudit(row);
  const detailsId = `audit-log-details-${row.id}`;
  const fields = summarizeDiff(row.diff);
  const href = recordHref(row);
  const risk = riskScore(row);

  return (
    <>
      <tr className="border-b border-[var(--border-subtle)] align-top transition hover:bg-[var(--surface-secondary)]/70">
        <td className="px-4 py-4">
          <div className="flex gap-3">
            <span className={cn('mt-1 h-14 w-1.5 shrink-0 rounded-full', classification.railClass)} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[var(--text-primary)]">{formatAction(row.action)}</span>
                <Badge tone={classification.tone}>{classification.label}</Badge>
                <Badge tone={risk >= 80 ? 'tomato' : risk >= 55 ? 'amber' : 'jade'}>Risk {risk}</Badge>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-[var(--text-muted)]">{row.action}</div>
              {fields.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {fields.slice(0, 3).map((field) => (
                    <span key={field} className="rounded-full bg-[var(--surface-secondary)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                      {field}
                    </span>
                  ))}
                  {fields.length > 3 && (
                    <span className="rounded-full bg-[var(--surface-secondary)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
                      +{fields.length - 3} more
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </td>

        <td className="px-4 py-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-secondary)] text-xs font-semibold text-[var(--text-primary)]"
            >
              {actorInitials(row)}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-[var(--text-primary)]">{actorLabel(row)}</div>
              <div className="truncate text-xs text-[var(--text-muted)]">{row.userEmail || 'System generated'}</div>
            </div>
          </div>
        </td>

        <td className="px-4 py-4">
          <div className="space-y-1">
            <Badge tone="gray">{row.targetType || 'system'}</Badge>
            <div
              className="font-mono text-xs text-[var(--text-muted)]"
              title={row.targetId ?? undefined}
              aria-label={row.targetId ? `Target id ${row.targetId}` : 'No record reference'}
            >
              {row.targetId ? truncateId(row.targetId) : 'No record reference'}
            </div>
            {row.targetId && (
              <div className="flex flex-wrap gap-1.5">
                {href && (
                  <Link
                    to={href}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
                  >
                    <Icon name="arrow" className="size-3" />
                    Open
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => writeClipboard(row.targetId ?? '')}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
                >
                  <Icon name="link" className="size-3" />
                  Copy ID
                </button>
              </div>
            )}
          </div>
        </td>

        <td className="px-4 py-4">
          <time dateTime={row.createdAt} aria-label={formatAbsolute(row.createdAt)} className="block font-medium text-[var(--text-primary)]">
            {relativeTime(row.createdAt)}
          </time>
          <div className="mt-1 text-xs text-[var(--text-muted)]">{formatAbsolute(row.createdAt)}</div>
        </td>

        <td className="px-4 py-4 text-right">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={detailsId}
            aria-label={`${isOpen ? 'Hide' : 'Inspect'} diff payload for ${formatAction(row.action)} by ${actorLabel(row)}`}
            onClick={onToggle}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-secondary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
          >
            {isOpen ? 'Hide' : 'Inspect'}
            <Icon name="caret" className={cn('size-3 transition', isOpen && 'rotate-180')} />
          </button>
        </td>
      </tr>

      {isOpen && (
        <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)]/70">
          <td colSpan={5} className="px-4 py-4">
            <div id={detailsId} role="region" aria-label={`Diff payload for ${formatAction(row.action)}`} className="grid gap-3 lg:grid-cols-[320px,1fr]">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Change summary</div>
                {fields.length > 0 ? (
                  <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
                    {fields.map((field) => (
                      <li key={field} className="flex gap-2">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]" />
                        <span>{field}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                    No structured diff was captured for this event. Use the raw payload when forensic detail is required.
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Raw evidence payload</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => writeClipboard(JSON.stringify(row.diff ?? {}, null, 2))}
                      className="inline-flex min-h-8 items-center rounded-lg border border-[var(--border-subtle)] px-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
                    >
                      Copy JSON
                    </button>
                    <Badge tone="gray">Immutable</Badge>
                  </div>
                </div>
                <pre className="max-h-[360px] overflow-auto rounded-xl bg-[var(--code-bg)] p-4 text-xs leading-6 text-[var(--code-fg)]">
                  {JSON.stringify(row.diff ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function parseDateRange(value: string | null): DateRange {
  return DATE_RANGES.some((option) => option.value === value) ? (value as DateRange) : '7d';
}

function parseTargetType(value: string | null): TargetTypeFilter {
  return TARGET_TYPES.some((option) => option.value === value) ? (value as TargetTypeFilter) : 'all';
}

function parseQuickFilter(value: string | null): QuickFilter {
  return QUICK_FILTERS.some((option) => option.value === value) ? (value as QuickFilter) : 'all';
}

function getSince(range: DateRange) {
  if (range === 'all') return undefined;
  const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30;
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function buildActivityBuckets(rows: AuditLogEntry[]) {
  const bucketCount = 12;
  if (rows.length === 0) {
    return Array.from({ length: bucketCount }, (_, index) => ({
      key: `empty-${index}`,
      label: '--',
      count: 0,
      security: 0,
      destructive: 0,
    }));
  }

  const times = rows.map((row) => new Date(row.createdAt).getTime()).filter(Number.isFinite);
  const latest = Math.max(...times);
  const earliest = Math.min(...times);
  const bucketMs = Math.max(Math.ceil((latest - earliest || 60 * 60 * 1000) / bucketCount), 60 * 1000);
  const start = latest - bucketMs * (bucketCount - 1);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    key: `${start + index * bucketMs}`,
    label: formatBucketLabel(start + index * bucketMs, bucketMs),
    count: 0,
    security: 0,
    destructive: 0,
  }));

  rows.forEach((row) => {
    const time = new Date(row.createdAt).getTime();
    if (!Number.isFinite(time)) return;
    const index = Math.max(0, Math.min(bucketCount - 1, Math.floor((time - start) / bucketMs)));
    const bucket = buckets[index];
    if (!bucket) return;
    const classification = classifyAudit(row);
    bucket.count += 1;
    if (classification.category === 'security') bucket.security += 1;
    if (classification.category === 'destructive') bucket.destructive += 1;
  });

  return buckets;
}

function formatBucketLabel(time: number, bucketMs: number) {
  const date = new Date(time);
  if (bucketMs <= 6 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function buildStats(rows: AuditLogEntry[]) {
  return rows.reduce(
    (stats, row, index) => {
      const classification = classifyAudit(row);
      stats[classification.category] += 1;
      if (index === 0) stats.latest = row.createdAt;
      return stats;
    },
    {
      total: rows.length,
      security: 0,
      destructive: 0,
      crm: 0,
      system: 0,
      all: rows.length,
      latest: undefined as string | undefined,
    },
  );
}

function buildEvidenceHealth(rows: AuditLogEntry[]) {
  const total = rows.length;
  const withDiff = rows.filter((row) => hasStructuredDiff(row.diff)).length;
  const withTarget = rows.filter((row) => Boolean(row.targetId)).length;
  const withActor = rows.filter((row) => Boolean(row.userName || row.userEmail || row.userId)).length;
  const diffPct = percent(withDiff, total);
  const targetPct = percent(withTarget, total);
  const actorPct = percent(withActor, total);
  const score = Math.round(diffPct * 0.4 + targetPct * 0.3 + actorPct * 0.3);

  return {
    total,
    withDiff,
    withTarget,
    withActor,
    diffPct,
    targetPct,
    actorPct,
    score,
  };
}

function percent(part: number, total: number) {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

function hasStructuredDiff(diff: unknown) {
  return Boolean(diff && typeof diff === 'object' && !Array.isArray(diff) && Object.keys(diff as Record<string, unknown>).length > 0);
}

function riskScore(row: AuditLogEntry) {
  const category = classifyAudit(row).category;
  const categoryScore = category === 'destructive' ? 82 : category === 'security' ? 68 : category === 'system' ? 42 : 28;
  const missingEvidencePenalty = (hasStructuredDiff(row.diff) ? 0 : 8) + (row.targetId ? 0 : 6) + (row.userEmail || row.userName || row.userId ? 0 : 4);
  return Math.min(99, categoryScore + missingEvidencePenalty);
}

function recordHref(row: AuditLogEntry) {
  if (!row.targetId || !row.targetType) return undefined;
  const id = encodeURIComponent(row.targetId);
  switch (row.targetType.toLowerCase()) {
    case 'account':
      return `/accounts/${id}`;
    case 'company':
      return `/companies/${id}`;
    case 'opportunity':
      return `/opportunities/${id}`;
    case 'contact':
      return `/contacts/${id}`;
    case 'lead':
      return `/leads/${id}`;
    case 'task':
      return `/tasks/${id}`;
    case 'invoice':
      return `/sales/invoices/${id}`;
    case 'service_desk':
    case 'ticket':
      return `/service-desk/${id}`;
    default:
      return undefined;
  }
}

function mostFrequent(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))[0];
}

function classifyAudit(row: AuditLogEntry): AuditClassification {
  const haystack = `${row.action} ${row.targetType ?? ''}`.toLowerCase();

  if (DESTRUCTIVE_TERMS.some((term) => haystack.includes(term))) {
    return {
      category: 'destructive',
      label: 'High attention',
      tone: 'tomato',
      railClass: 'bg-[var(--tag-tomato-fg)]',
    };
  }

  if (SECURITY_TERMS.some((term) => haystack.includes(term))) {
    return {
      category: 'security',
      label: 'Security/API',
      tone: 'purple',
      railClass: 'bg-[var(--tag-purple-fg)]',
    };
  }

  if (CRM_TARGETS.has((row.targetType ?? '').toLowerCase())) {
    return {
      category: 'crm',
      label: 'CRM change',
      tone: 'teal',
      railClass: 'bg-[var(--tag-teal-fg)]',
    };
  }

  if (SYSTEM_TERMS.some((term) => haystack.includes(term)) || (!row.userId && !row.userEmail)) {
    return {
      category: 'system',
      label: 'System',
      tone: 'gray',
      railClass: 'bg-[var(--tag-gray-fg)]',
    };
  }

  return {
    category: 'crm',
    label: 'Activity',
    tone: 'blue',
    railClass: 'bg-[var(--tag-blue-fg)]',
  };
}

function rowMatchesQuickFilter(row: AuditLogEntry, quickFilter: QuickFilter) {
  if (quickFilter === 'all') return true;
  return classifyAudit(row).category === quickFilter;
}

function rowMatchesSearch(row: AuditLogEntry, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const values = [
    row.action,
    row.targetType,
    row.targetId,
    row.userName,
    row.userEmail,
    row.userId,
    safeStringify(row.diff),
  ];
  return values.some((value) => value?.toLowerCase().includes(query));
}

function formatAction(action: string) {
  return action
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function actorLabel(row: AuditLogEntry) {
  return row.userName || row.userEmail || row.userId || 'System';
}

function actorInitials(row: AuditLogEntry) {
  const label = actorLabel(row);
  const parts = label
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return 'SY';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function truncateId(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatAbsolute(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function summarizeDiff(diff: unknown) {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return [];

  return Object.entries(diff as Record<string, unknown>)
    .slice(0, 8)
    .map(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if ('from' in nested || 'to' in nested) {
          return `${humanizeKey(key)}: ${formatValue(nested.from)} to ${formatValue(nested.to)}`;
        }
        return `${humanizeKey(key)} updated`;
      }
      return `${humanizeKey(key)}: ${formatValue(value)}`;
    });
}

function humanizeKey(key: string) {
  return key
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'object';
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '';
  }
}

function writeClipboard(value: string) {
  if (!value) return;
  void navigator.clipboard?.writeText(value);
}

function exportCsv(rows: AuditLogEntry[]) {
  if (rows.length === 0) return;
  const header = ['createdAt', 'actor', 'email', 'action', 'category', 'riskScore', 'targetType', 'targetId', 'diff'];
  const csv = [
    header.join(','),
    ...rows.map((row) =>
      [
        row.createdAt,
        actorLabel(row),
        row.userEmail ?? '',
        row.action,
        classifyAudit(row).category,
        riskScore(row),
        row.targetType ?? '',
        row.targetId ?? '',
        safeStringify(row.diff),
      ]
        .map(escapeCsv)
        .join(','),
    ),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `bidstack-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  const safeText = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}
