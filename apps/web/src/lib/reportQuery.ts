// Pure query-assembly helpers for the report builder. Extracted from the page
// so they stay unit-testable and the page file is a clean fast-refresh boundary.

import type {
  Aggregate,
  FilterGroup,
  GroupBy,
  ReportEntityType,
  ReportQuery,
  SortField,
} from '@/hooks/useAnalyticsReports';

/** Drop empty/blank filter conditions and prune empty nested groups (the engine
 *  rejects empty nested groups with a 400). Returns null when nothing is left. */
export function pruneFilters(group: FilterGroup): FilterGroup | null {
  const kept = group.conditions
    .map((c) => {
      if ('logic' in c) return pruneFilters(c);
      if (!c.field) return null;
      const needsValue = c.operator !== 'isNull' && c.operator !== 'isNotNull';
      if (needsValue && (c.value === undefined || c.value === '')) return null;
      return c;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  if (kept.length === 0) return null;
  return { ...group, conditions: kept };
}

/** Output column aliases the engine will emit — the only valid sort targets. */
export function outputAliases(aggregates: Aggregate[], groupBy: GroupBy[]): string[] {
  const keys = groupBy.filter((g) => g.field).map((g) => g.field);
  if (aggregates.length === 0) {
    if (groupBy.length > 0) keys.push('value'); // groupBy w/o aggregates auto-counts
    return keys;
  }
  if (aggregates.length === 1) {
    keys.push(aggregates[0]!.alias?.trim() || 'value');
    return keys;
  }
  for (const a of aggregates) {
    keys.push(a.alias?.trim() || `${a.fn}_${a.field === '*' ? 'all' : a.field}`.toLowerCase());
  }
  return keys;
}

export function buildQuery(input: {
  entity: ReportEntityType;
  filters: FilterGroup;
  aggregates: Aggregate[];
  groupBy: GroupBy[];
  sort: SortField[];
  limit: number;
}): ReportQuery {
  const q: ReportQuery = { entity: input.entity };
  const pruned = pruneFilters(input.filters);
  if (pruned) q.filters = pruned;
  const aggregates = input.aggregates
    .filter((a) => a.fn === 'COUNT' || a.field)
    .map((a) => ({ fn: a.fn, field: a.field, ...(a.alias?.trim() ? { alias: a.alias.trim() } : {}) }));
  if (aggregates.length > 0) q.aggregates = aggregates;
  const groupBy = input.groupBy.filter((g) => g.field);
  if (groupBy.length > 0) q.groupBy = groupBy;
  const sort = input.sort.filter((s) => s.field);
  if (sort.length > 0) q.sort = sort;
  if (input.limit) q.limit = input.limit;
  return q;
}
