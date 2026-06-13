// Pure query-assembly helpers for the report builder. Extracted from the page
// so they stay unit-testable and the page file is a clean fast-refresh boundary.
//
// These mirror the analytics engine's emitted-alias rules EXACTLY so the builder
// never produces a query the engine 400s on:
//   - a lone aggregate is aliased 'value'; multi-aggregates use explicit alias or
//     `{fn}_{field}` (with '*' -> 'all'); duplicate derived names are suffixed _2.. ;
//   - groupBy without aggregates auto-counts to a 'value' column;
//   - sort fields must equal an emitted output alias, else 400.

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

/** Aggregates that carry real config (COUNT may use the implicit '*' field). */
function keptAggregates(aggregates: Aggregate[]): Aggregate[] {
  return aggregates.filter((a) => a.fn === 'COUNT' || a.field);
}

/**
 * The unique alias each kept aggregate will be emitted under, aligned 1:1 with
 * the kept-aggregate array. Mirrors the engine: lone aggregate -> 'value';
 * otherwise explicit alias or `{fn}_{field}`; duplicates get a numeric suffix so
 * the engine never throws "Duplicate output alias".
 */
export function resolveAggregateAliases(aggregates: Aggregate[]): string[] {
  const kept = keptAggregates(aggregates);
  const base = kept.map((a) => {
    const explicit = a.alias?.trim();
    if (explicit) return explicit;
    if (kept.length === 1) return 'value';
    return `${a.fn}_${a.field === '*' ? 'all' : a.field}`.toLowerCase();
  });
  const seen = new Map<string, number>();
  return base.map((name) => {
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name}_${n + 1}`;
  });
}

/** Output column aliases the engine will emit — the only valid sort targets.
 *  Empty when the query is a plain row-select (no aggregates, no real groupBy):
 *  those emit raw column keys, which the UI sources from the field picker. */
export function outputAliases(aggregates: Aggregate[], groupBy: GroupBy[]): string[] {
  const groupKeys = groupBy.filter((g) => g.field).map((g) => g.field);
  const aggAliases = resolveAggregateAliases(aggregates);
  if (aggAliases.length === 0) {
    // groupBy without aggregates auto-injects COUNT(*) as 'value' — but ONLY when
    // there is at least one real group field (matches the engine after pruning).
    return groupKeys.length > 0 ? [...groupKeys, 'value'] : groupKeys;
  }
  return [...groupKeys, ...aggAliases];
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

  // Emit aggregates with explicit, de-duplicated aliases so the engine's output
  // columns are deterministic and collision-free.
  const kept = keptAggregates(input.aggregates);
  const aliases = resolveAggregateAliases(input.aggregates);
  if (kept.length > 0) {
    q.aggregates = kept.map((a, i) => ({ fn: a.fn, field: a.field, alias: aliases[i]! }));
  }

  const groupBy = input.groupBy.filter((g) => g.field);
  if (groupBy.length > 0) q.groupBy = groupBy;

  // Sort fields must equal an emitted alias. When the emitted set is known
  // (aggregated/grouped query) drop any stale sort that isn't in it, so a
  // leftover selection can never produce an opaque 400. A plain row-select has
  // no fixed alias set (raw columns) — leave those as the field picker supplied.
  const emitted = outputAliases(input.aggregates, input.groupBy);
  let sort = input.sort.filter((s) => s.field);
  if (emitted.length > 0) sort = sort.filter((s) => emitted.includes(s.field));
  if (sort.length > 0) q.sort = sort;

  if (input.limit) q.limit = Math.max(1, Math.min(1000, input.limit));
  return q;
}
