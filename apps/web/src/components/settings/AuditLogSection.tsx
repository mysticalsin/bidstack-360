import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useAuditLogs } from '@/hooks/useAuditLogs';

import {
  buildStats,
  getSince,
  parseDateRange,
  parseQuickFilter,
  parseTargetType,
  rowMatchesQuickFilter,
  rowMatchesSearch,
} from '@/pages/audit-log/audit-log-helpers';
import { EMPTY_AUDIT_ROWS, EVENT_LIMIT } from '@/pages/audit-log/audit-log-types';
import { AuditHero } from '@/pages/audit-log/AuditLogHero';
import { AuditInsightStrip } from '@/pages/audit-log/AuditLogInsights';
import { AuditFilterBar } from '@/pages/audit-log/AuditLogFilters';
import { AuditTable } from '@/pages/audit-log/AuditLogTable';

export function AuditLogSection() {
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
    () =>
      rows
        .filter((row) => rowMatchesQuickFilter(row, quickFilter))
        .filter((row) => rowMatchesSearch(row, search)),
    [quickFilter, rows, search],
  );
  const stats = useMemo(() => buildStats(rows), [rows]);

  const resetEvidencePage = () => {
    setCursorStack([]);
    setExpanded({});
  };
  const updateFilterParams = (
    patch: Partial<Record<'q' | 'range' | 'target' | 'category', string | undefined>>,
    replace = true,
  ) => {
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
    <div className="space-y-5">
      <AuditHero
        stats={stats}
        totalVisible={visibleRows.length}
        page={cursorStack.length + 1}
        isLoading={query.isLoading || query.isFetching}
        lastRefreshedAt={
          query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : undefined
        }
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
        setQuickFilter={(value) =>
          updateFilterParams({ category: value === 'all' ? undefined : value })
        }
        rows={visibleRows}
        onClear={clearFilters}
        onRefresh={() => {
          void query.refetch();
        }}
        isRefreshing={query.isFetching}
      />

      {/* sr-only live region — announces filter result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!query.isLoading && query.data
          ? `${visibleRows.length} event${visibleRows.length === 1 ? '' : 's'}${search ? ` matching "${search}"` : ''}${quickFilter !== 'all' ? ` · ${quickFilter}` : ''}`
          : ''}
      </p>

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
