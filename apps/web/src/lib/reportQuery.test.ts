import { describe, expect, it } from 'vitest';

import { buildQuery, outputAliases, pruneFilters } from './reportQuery';
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

  it('assembles a grouped aggregate query and strips blank aggregate aliases', () => {
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
    expect(q.aggregates).toEqual([{ fn: 'SUM', field: 'valueMicros' }]); // blank alias stripped
    expect(q.groupBy).toEqual([{ field: 'dueDate', timeBucket: 'MONTH' }]);
    expect(q.filters?.conditions).toHaveLength(1);
    expect(q.sort).toEqual([{ field: 'value', dir: 'desc' }]);
  });
});
