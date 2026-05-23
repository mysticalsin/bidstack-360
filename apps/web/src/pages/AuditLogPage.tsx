import { useMemo, useState } from 'react';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { relativeTime } from '@/lib/format';

type DateRange = '24h' | '7d' | '30d' | 'all';
type TargetTypeFilter = 'all' | 'opportunity' | 'company' | 'api_key' | 'mcp';

const RANGE_HOURS: Record<DateRange, number | null> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  all: null,
};

export function AuditLogPage() {
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<DateRange>('7d');
  const [targetType, setTargetType] = useState<TargetTypeFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Computed in the URL so the React Query cache key changes deterministically;
  // a long-open tab can't drift into stale page boundaries. The `Date.now()`
  // call is wrapped in useState's lazy initializer so each render gets the
  // same cutoff (purity rule); changing the range remounts via the effect.
  const [nowMs] = useState(() => Date.now());
  const since = useMemo(() => {
    const hours = RANGE_HOURS[range];
    if (hours === null) return undefined;
    return new Date(nowMs - hours * 3600 * 1000).toISOString();
  }, [range, nowMs]);

  const filter = {
    limit: 100,
    ...(search ? { action: search } : {}),
    ...(since ? { since } : {}),
    ...(targetType !== 'all' ? { targetType } : {}),
  };

  const { data, isLoading, isError, error } = useAuditLogs(filter);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {data ? `${data.items.length} entries` : 'Loading entries…'} · read-only history
        </p>
      </header>

      <FilterBar
        search={search}
        onSearch={setSearch}
        range={range}
        onRange={setRange}
        targetType={targetType}
        onTargetType={setTargetType}
      />

      <Card className="overflow-hidden">
        {isLoading ? (
          <LoadingSkeleton rows={8} />
        ) : isError ? (
          <ErrorState
            title="Couldn't load audit log"
            message={error instanceof Error ? error.message : 'Try again in a moment.'}
          />
        ) : (
          <AuditTable
            rows={data?.items ?? []}
            expanded={expanded}
            onToggle={(id) => setExpanded((cur) => (cur === id ? null : id))}
          />
        )}
      </Card>
    </div>
  );
}

interface FilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  range: DateRange;
  onRange: (v: DateRange) => void;
  targetType: TargetTypeFilter;
  onTargetType: (v: TargetTypeFilter) => void;
}

function FilterBar({ search, onSearch, range, onRange, targetType, onTargetType }: FilterBarProps) {
  const inputCx =
    'inline-flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--fg-secondary)] focus-within:border-[var(--border-focus)] focus-within:ring-2 focus-within:ring-[var(--brand-primary-tint)] min-h-11';
  return (
    <Card className="p-3">
      <div
        className="flex flex-wrap items-center gap-2"
        role="search"
        aria-label="Audit log filters"
      >
        <label className={inputCx}>
          <Icon name="search" size={14} />
          <span className="sr-only">Search by action</span>
          <input
            type="search"
            placeholder="Filter by action (e.g. stage, mcp)…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="bg-transparent outline-none text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)]"
          />
        </label>
        <label className={inputCx}>
          <Icon name="reports" size={14} />
          <span className="sr-only">Date range</span>
          <select
            value={range}
            onChange={(e) => onRange(e.target.value as DateRange)}
            className="bg-transparent outline-none text-[var(--fg-primary)]"
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </label>
        <label className={inputCx}>
          <Icon name="briefcase" size={14} />
          <span className="sr-only">Target type</span>
          <select
            value={targetType}
            onChange={(e) => onTargetType(e.target.value as TargetTypeFilter)}
            className="bg-transparent outline-none text-[var(--fg-primary)]"
          >
            <option value="all">All targets</option>
            <option value="opportunity">Opportunity</option>
            <option value="company">Company</option>
            <option value="api_key">API key</option>
            <option value="mcp">MCP</option>
          </select>
        </label>
      </div>
    </Card>
  );
}

interface AuditRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  userName: string | null;
  userEmail: string | null;
  diff?: unknown;
  createdAt: string;
}

interface TableProps {
  rows: AuditRow[];
  expanded: string | null;
  onToggle: (id: string) => void;
}

function AuditTable({ rows, expanded, onToggle }: TableProps) {
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Audit log entries, newest first</caption>
      <thead className="bg-[var(--surface-sunken)] text-xs text-[var(--fg-tertiary)] uppercase tracking-wider">
        <tr>
          <th scope="col" className="px-5 py-3 font-semibold">
            When
          </th>
          <th scope="col" className="px-5 py-3 font-semibold">
            Actor
          </th>
          <th scope="col" className="px-5 py-3 font-semibold">
            Action
          </th>
          <th scope="col" className="px-5 py-3 font-semibold">
            Target
          </th>
          <th scope="col" className="px-5 py-3 font-semibold">
            Reference
          </th>
          <th scope="col" className="px-5 py-3 font-semibold text-right">
            <span className="sr-only">Expand</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border-subtle)]">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-5 py-8">
              <EmptyState
                title="No audit events match your filters"
                message="Backend writers stamp entries on opportunity edits, MCP tool calls, and CRM enrichment."
              />
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <RowPair
              key={row.id}
              row={row}
              isOpen={expanded === row.id}
              onToggle={() => onToggle(row.id)}
            />
          ))
        )}
      </tbody>
    </table>
  );
}

interface RowProps {
  row: AuditRow;
  isOpen: boolean;
  onToggle: () => void;
}

function RowPair({ row, isOpen, onToggle }: RowProps) {
  const actor = row.userName ?? row.userEmail ?? 'system';
  return (
    <>
      <tr
        className="hover:bg-[var(--surface-sunken)] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
        onClick={onToggle}
        aria-expanded={isOpen}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <td
          className="px-5 py-3 text-[var(--fg-secondary)] whitespace-nowrap"
          title={new Date(row.createdAt).toISOString()}
        >
          {relativeTime(row.createdAt)}
        </td>
        <td className="px-5 py-3 text-[var(--fg-secondary)]">{actor}</td>
        <td className="px-5 py-3">
          <Badge tone={actionTone(row.action)}>{row.action}</Badge>
        </td>
        <td className="px-5 py-3 text-[var(--fg-secondary)]">{row.targetType ?? '—'}</td>
        <td className="px-5 py-3 font-mono text-xs text-[var(--fg-tertiary)]">
          {row.targetId ? truncateId(row.targetId) : '—'}
        </td>
        <td className="px-5 py-3 text-right">
          <Icon name={isOpen ? 'caretup' : 'caret'} size={14} />
        </td>
      </tr>
      {isOpen ? (
        <tr aria-label="Diff payload" className="bg-[var(--surface-sunken)]">
          <td colSpan={6} className="px-5 py-4">
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-[var(--fg-secondary)]">
              {JSON.stringify(row.diff ?? {}, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function truncateId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function actionTone(action: string): BadgeTone {
  if (action.includes('delete') || action.includes('revoke')) return 'tomato';
  if (action.includes('stage') || action.includes('update')) return 'amber';
  if (action.includes('mcp')) return 'purple';
  if (action.includes('create') || action.includes('enrich')) return 'jade';
  return 'gray';
}
