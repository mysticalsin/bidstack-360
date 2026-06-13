import { describe, expect, it } from 'vitest';

import { buildQuery, outputAliases, pruneFilters, resolveAggregateAliases } from './reportQuery';
import type { Aggregate, FilterGroup, GroupBy } from '@/hooks/useAnalyticsReports';

describe('pruneFilters', () => {
  it('drops blank conditions and returns null for an empty group', () => {
    const g: FilterGroup = { logic: 'AND', conditions: [{ field: '', operator: 'eq', value: '' }] };
    expect(pruneFilters(g)).toBeNull();
  });

  it('drops a value-requiring condition with an empty value but keeps null-checks', () => {
    const g: FilterGroup = {
      logic: 'AND',
      conditions: [
        { field: 'stage', operator: 'eq', value: '' }, // dropped
        { field: 'email', operator: 'isNotNull' }, // kept (no value needed)
      ],
    };
    const out = pruneFilters(g);
    expect(out?.conditions).toHaveLength(1);
    expect((out?.conditions[0] as { operator: string }).operator).toBe('isNotNull');
  });

  it('prunes empty nested groups (engine rejects them with 400)', () => {
    const g: FilterGroup = {
      logic: 'AND',
      conditions: [
        { field: 'stage', operator: 'eq', value: 'closed_won' },
        { logic: 'OR', conditions: [] }, // empty nested group -> pruned
      ],
    };
    const out = pruneFilters(g);
    expect(out?.conditions).toHaveLength(1);
  });
});

describe('outputAliases', () => {
  it('a single aggregate without alias emits "value"', () => {
    const aggs: Aggregate[] = [{ fn: 'COUNT', field: '*' }];
    expect(outputAliases(aggs, [])).toEqual(['value']);
  });

  it('groupBy without aggregates appends the auto-count "value" alias', () => {
    const gb: GroupBy[] = [{ field: 'stage' }];
    expect(outputAliases([], gb)).toEqual(['stage', 'value']);
  });

  // Regression: a group-by row with a BLANK field must NOT offer the 'value'
  // alias — the engine prunes the blank group and never emits 'value', so a
  // sort on it would 400 (review finding 1).
  it('a blank-field groupBy alone emits no aliases', () => {
    expect(outputAliases([], [{ field: '' }])).toEqual([]);
  });

  it('multiple aggregates use explicit alias or fn_field fallback', () => {
    const aggs: Aggregate[] = [
      { fn: 'SUM', field: 'valueMicros', alias: 'revenue' },
      { fn: 'AVG', field: 'probability' },
    ];
    expect(outputAliases(aggs, [{ field: 'stage' }])).toEqual([
      'stage',
      'revenue',
      'avg_probability',
    ]);
  });
});

describe('resolveAggregateAliases', () => {
  // Regression: two unaliased identical aggregates must NOT collide — the engine
  // throws "Duplicate output alias" otherwise (review finding 2).
  it('disambiguates duplicate derived aliases with a numeric suffix', () => {
    const aggs: Aggregate[] = [
      { fn: 'COUNT', field: '*' },
      { fn: 'COUNT', field: '*' },
    ];
    expect(resolveAggregateAliases(aggs)).toEqual(['count_all', 'count_all_2']);
  });
});

describe('buildQuery', () => {
  it('omits empty filters/aggregates/groupBy/sort and keeps entity + limit', () => {
    const q = buildQuery({
      entity: 'opportunity',
      filters: { logic: 'AND', conditions: [] },
      aggregates: [],
      groupBy: [],
      sort: [],
      limit: 100,
    });
    expect(q).toEqual({ entity: 'opportunity', limit: 100 });
  });

  it('assembles a grouped aggregate query with an explicit emitted alias', () => {
    const q = buildQuery({
      entity: 'opportunity',
      filters: {
        logic: 'AND',
        conditions: [{ field: 'stage', operator: 'eq', value: 'closed_won' }],
      },
      aggregates: [{ fn: 'SUM', field: 'valueMicros', alias: '   ' }],
      groupBy: [{ field: 'dueDate', timeBucket: 'MONTH' }],
      sort: [{ field: 'value', dir: 'desc' }],
      limit: 50,
    });
    // Lone aggregate is emitted with the explicit 'value' alias.
    expect(q.aggregates).toEqual([{ fn: 'SUM', field: 'valueMicros', alias: 'value' }]);
    expect(q.groupBy).toEqual([{ field: 'dueDate', timeBucket: 'MONTH' }]);
    expect(q.filters?.conditions).toHaveLength(1);
    expect(q.sort).toEqual([{ field: 'value', dir: 'desc' }]); // 'value' is emitted -> kept
  });

  // Regression: a sort referencing an alias the query no longer emits must be
  // dropped client-side, not sent to 400 (review finding 5).
  it('drops a stale sort field that is not an emitted alias', () => {
    const q = buildQuery({
      entity: 'opportunity',
      filters: { logic: 'AND', conditions: [] },
      aggregates: [{ fn: 'SUM', field: 'valueMicros', alias: 'revenue' }],
      groupBy: [{ field: 'stage' }],
      sort: [{ field: 'gonezo', dir: 'asc' }], // not in ['stage','revenue']
      limit: 100,
    });
    expect(q.sort).toBeUndefined();
  });

  it('clamps an out-of-range limit into 1..1000', () => {
    const base = {
      entity: 'lead' as const,
      filters: { logic: 'AND' as const, conditions: [] },
      aggregates: [],
      groupBy: [],
      sort: [],
    };
    expect(buildQuery({ ...base, limit: 99999 }).limit).toBe(1000);
    expect(buildQuery({ ...base, limit: 0 }).limit).toBeUndefined(); // 0 -> omit (server default)
  });
});
