// Unit tests for the analytics SQL compiler. Pure — asserts on the generated
// parameterized SQL text + bound values, no database required.
//
// WHY these tests matter: the engine is the only thing standing between a
// user-controlled query JSON and raw SQL. Every assertion here encodes a
// security invariant (allowlisted identifiers, parameterized values,
// mandatory org scoping) or a wire-contract guarantee (KPI 'value' alias).
import { describe, expect, it } from 'vitest';

import type { AnalyticsFilterGroup, AnalyticsQuery } from '@bidstack/shared';

import {
  ANALYTICS_DEFAULT_LIMIT,
  ANALYTICS_MAX_LIMIT,
  AnalyticsQueryError,
  clampLimit,
  compileAnalyticsQuery,
  escapeLikePattern,
} from './analytics-engine.js';

const ORG = '11111111-2222-3333-4444-555555555555';

function compile(query: AnalyticsQuery): { text: string; values: unknown[] } {
  const sql = compileAnalyticsQuery(ORG, query);
  return { text: sql.text, values: sql.values as unknown[] };
}

describe('analytics-engine compile', () => {
  it('always org-scopes and soft-delete-filters the WHERE clause', () => {
    const { text, values } = compile({ entity: 'task' });
    expect(text).toContain('WHERE org_id = $1::uuid AND deleted_at IS NULL');
    expect(values[0]).toBe(ORG);
  });

  it('a user-supplied orgId/org_id filter can never override the injected tenant scope, on every entity', () => {
    // WHY: compileAnalyticsQuery is the highest-blast-radius raw-SQL surface
    // in the app — it's guard-exempt (packages/db's tenant-scope-guard only
    // intercepts Prisma model calls, not $queryRaw) and turns user-authored
    // query JSON directly into SQL. Its ONLY tenant boundary is that org_id
    // is injected as a literal, parameterized, always-first WHERE clause
    // (see compileAnalyticsQuery) and 'orgId'/'org_id' is never present in
    // any entity's field allowlist. This test proves both halves hold for
    // every entity: a request body naming the field 'orgId' (attempting to
    // smuggle a second org_id condition, e.g. to OR across tenants) is
    // rejected outright, and the compiled SQL still carries exactly one
    // org-scoping predicate bound to the caller's own org.
    const entities: AnalyticsQuery['entity'][] = [
      'lead',
      'opportunity',
      'contact',
      'company',
      'task',
      'activity',
      'goal',
    ];
    for (const entity of entities) {
      expect(() =>
        compile({
          entity,
          filters: {
            logic: 'OR',
            conditions: [{ field: 'orgId', operator: 'eq', value: 'attacker-org' }],
          },
        }),
      ).toThrow(AnalyticsQueryError);
      expect(() =>
        compile({
          entity,
          filters: {
            logic: 'OR',
            conditions: [{ field: 'org_id', operator: 'eq', value: 'attacker-org' }],
          },
        }),
      ).toThrow(AnalyticsQueryError);

      // With no attempted override, exactly one org_id predicate is compiled,
      // bound to the caller's own org — never the attacker-supplied value.
      const { text, values } = compile({ entity });
      expect(text.match(/org_id = \$1::uuid/g)).toHaveLength(1);
      expect(values[0]).toBe(ORG);
      expect(values).not.toContain('attacker-org');
    }
  });

  it('rejects filter fields outside the allowlist (no identifier injection)', () => {
    const query: AnalyticsQuery = {
      entity: 'task',
      filters: {
        logic: 'AND',
        conditions: [{ field: 'title"; DROP TABLE tasks; --', operator: 'eq', value: 'x' }],
      },
    };
    expect(() => compile(query)).toThrow(AnalyticsQueryError);
  });

  it('rejects unknown sort, groupBy, and aggregate fields', () => {
    expect(() => compile({ entity: 'task', sort: [{ field: 'orgId', dir: 'asc' }] })).toThrow(
      AnalyticsQueryError,
    );
    expect(() =>
      compile({ entity: 'task', aggregates: [{ fn: 'COUNT', field: '*' }], groupBy: [{ field: 'nope' }] }),
    ).toThrow(AnalyticsQueryError);
    expect(() => compile({ entity: 'task', aggregates: [{ fn: 'SUM', field: 'nope' }] })).toThrow(
      AnalyticsQueryError,
    );
  });

  it('builds nested AND/OR trees as parenthesized SQL with bound params', () => {
    const filters: AnalyticsFilterGroup = {
      logic: 'AND',
      conditions: [
        { field: 'status', operator: 'eq', value: 'open' },
        {
          logic: 'OR',
          conditions: [
            { field: 'title', operator: 'contains', value: 'rfp' },
            { field: 'dueDate', operator: 'isNull' },
          ],
        },
      ],
    };
    const { text, values } = compile({ entity: 'task', filters });
    expect(text).toContain('(status::text = $2 AND (title ILIKE $3 OR due_date IS NULL))');
    expect(values).toContain('open');
    expect(values).toContain('%rfp%');
  });

  it('escapes ILIKE wildcards so user input matches literally', () => {
    expect(escapeLikePattern('50%_done\\')).toBe('50\\%\\_done\\\\');
    const { values } = compile({
      entity: 'task',
      filters: { logic: 'AND', conditions: [{ field: 'title', operator: 'startsWith', value: '50%' }] },
    });
    expect(values).toContain('50\\%%');
  });

  it('compiles time buckets via date_trunc on date columns only', () => {
    const { text, values } = compile({
      entity: 'opportunity',
      aggregates: [{ fn: 'SUM', field: 'valueMicros' }],
      groupBy: [{ field: 'createdAt', timeBucket: 'MONTH' }],
    });
    // Bucket name is a BOUND parameter, never interpolated text.
    expect(text).toMatch(/date_trunc\(\$\d+::text, created_at\) AS "createdAt"/);
    expect(text).toMatch(/GROUP BY date_trunc\(\$\d+::text, created_at\)/);
    expect(values).toContain('month');
    // timeBucket on a non-date field is rejected
    expect(() =>
      compile({
        entity: 'opportunity',
        aggregates: [{ fn: 'COUNT', field: '*' }],
        groupBy: [{ field: 'stage', timeBucket: 'MONTH' }],
      }),
    ).toThrow(AnalyticsQueryError);
  });

  it('clamps limit into [1, 1000] instead of erroring', () => {
    expect(clampLimit(undefined)).toBe(ANALYTICS_DEFAULT_LIMIT);
    expect(clampLimit(5000)).toBe(ANALYTICS_MAX_LIMIT);
    expect(clampLimit(-5)).toBe(1);
    const { values } = compile({ entity: 'task', limit: 99999 });
    expect(values).toContain(ANALYTICS_MAX_LIMIT);
  });

  it('caps filter depth at 5 and total conditions at 50', () => {
    let deep: AnalyticsFilterGroup = {
      logic: 'AND',
      conditions: [{ field: 'status', operator: 'eq', value: 'open' }],
    };
    for (let i = 0; i < 6; i += 1) deep = { logic: 'AND', conditions: [deep] };
    expect(() => compile({ entity: 'task', filters: deep })).toThrow(/max depth/);

    const wide: AnalyticsFilterGroup = {
      logic: 'OR',
      conditions: Array.from({ length: 51 }, () => ({
        field: 'status' as const,
        operator: 'eq' as const,
        value: 'open',
      })),
    };
    expect(() => compile({ entity: 'task', filters: wide })).toThrow(/conditions/);
  });

  it("aliases a lone aggregate without groupBy as 'value' (KPI contract)", () => {
    const { text } = compile({ entity: 'task', aggregates: [{ fn: 'COUNT', field: '*' }] });
    expect(text).toContain('COUNT(*)::int AS "value"');
  });

  it('aliases grouped aggregates by alias or fn_field lowercased', () => {
    const { text } = compile({
      entity: 'opportunity',
      aggregates: [
        { fn: 'SUM', field: 'valueMicros', alias: 'pipeline' },
        { fn: 'AVG', field: 'probability' },
      ],
      groupBy: [{ field: 'stage' }],
    });
    expect(text).toContain('stage::text AS "stage"');
    // SUM coalesces so zero-row groups read 0, not null (KPI tiles expect 0).
    expect(text).toContain('COALESCE(SUM(value_micros), 0)::float8 AS "pipeline"');
    expect(text).toContain('AVG(probability)::float8 AS "avg_probability"');
  });

  it("a lone unaliased aggregate is 'value' even when grouped (chart series contract)", () => {
    const { text } = compile({
      entity: 'task',
      aggregates: [{ fn: 'COUNT', field: '*' }],
      groupBy: [{ field: 'status' }],
    });
    expect(text).toContain('COUNT(*)::int AS "value"');
  });

  it('grouped queries get a deterministic default ORDER BY on the group keys', () => {
    const { text } = compile({
      entity: 'opportunity',
      aggregates: [{ fn: 'COUNT', field: '*' }],
      groupBy: [{ field: 'createdAt', timeBucket: 'MONTH' }],
    });
    expect(text).toContain('ORDER BY "createdAt" ASC');
  });

  it('rejects garbage number values that Number() would silently coerce to 0', () => {
    for (const bad of ['', '  ', [], 'Infinity', 'NaN', '1e9999', {}]) {
      expect(() =>
        compile({
          entity: 'opportunity',
          filters: {
            logic: 'AND',
            conditions: [{ field: 'valueMicros', operator: 'gt', value: bad }],
          },
        }),
      ).toThrow(AnalyticsQueryError);
    }
    const { values } = compile({
      entity: 'opportunity',
      filters: {
        logic: 'AND',
        conditions: [{ field: 'valueMicros', operator: 'gt', value: '1500000' }],
      },
    });
    expect(values).toContain(1500000);
  });

  it('rejects empty NESTED groups but treats an empty top-level group as no-filters', () => {
    const { text } = compile({
      entity: 'task',
      filters: { logic: 'OR', conditions: [] },
    });
    expect(text).toMatch(/WHERE org_id = \$1::uuid AND deleted_at IS NULL (ORDER BY|LIMIT)/);
    expect(() =>
      compile({
        entity: 'task',
        filters: { logic: 'AND', conditions: [{ logic: 'OR', conditions: [] }] },
      }),
    ).toThrow(/at least one condition/);
  });

  it('caps in/notIn lists so a stored query cannot blow up the parameter list', () => {
    expect(() =>
      compile({
        entity: 'task',
        filters: {
          logic: 'AND',
          conditions: [
            { field: 'title', operator: 'in', value: Array.from({ length: 201 }, (_, i) => `t${i}`) },
          ],
        },
      }),
    ).toThrow(/at most 200/);
  });

  it('validates the optional timezone and binds it for local bucket boundaries', () => {
    const { text, values } = compile({
      entity: 'opportunity',
      aggregates: [{ fn: 'COUNT', field: '*' }],
      groupBy: [{ field: 'createdAt', timeBucket: 'WEEK' }],
      timezone: 'Europe/Paris',
    });
    expect(text).toMatch(/created_at AT TIME ZONE \$\d+/);
    expect(values).toContain('Europe/Paris');
    expect(() =>
      compile({
        entity: 'opportunity',
        aggregates: [{ fn: 'COUNT', field: '*' }],
        groupBy: [{ field: 'createdAt', timeBucket: 'WEEK' }],
        timezone: 'Mars/Olympus',
      }),
    ).toThrow(/Unknown timezone/);
  });

  it('type-checks aggregates against the field map (SUM on text rejected)', () => {
    expect(() => compile({ entity: 'task', aggregates: [{ fn: 'SUM', field: 'title' }] })).toThrow(
      AnalyticsQueryError,
    );
    expect(() => compile({ entity: 'task', aggregates: [{ fn: 'AVG', field: 'status' }] })).toThrow(
      AnalyticsQueryError,
    );
  });

  it('validates enum filter values against the schema enum', () => {
    expect(() =>
      compile({
        entity: 'task',
        filters: { logic: 'AND', conditions: [{ field: 'status', operator: 'eq', value: 'nope' }] },
      }),
    ).toThrow(/expects one of/);
  });

  it('treats groupBy without aggregates as a row count per group', () => {
    const { text } = compile({ entity: 'lead', groupBy: [{ field: 'status' }] });
    expect(text).toContain('COUNT(*)::int AS "value"');
    expect(text).toContain('GROUP BY status::text');
  });

  it('plain row selects emit only allowlisted columns with a stable default order', () => {
    const { text } = compile({ entity: 'task' });
    expect(text).toContain('title AS "title"');
    expect(text).toContain('status::text AS "status"');
    expect(text).toContain('ORDER BY "createdAt" DESC');
    expect(text).not.toContain('assignee_id');
  });

  it('allows sorting by an aggregate alias and rejects unknown sort keys', () => {
    const { text } = compile({
      entity: 'task',
      aggregates: [{ fn: 'COUNT', field: '*', alias: 'n' }],
      groupBy: [{ field: 'status' }],
      sort: [{ field: 'n', dir: 'desc' }],
    });
    expect(text).toContain('ORDER BY "n" DESC');
    expect(() =>
      compile({
        entity: 'task',
        aggregates: [{ fn: 'COUNT', field: '*' }],
        groupBy: [{ field: 'status' }],
        sort: [{ field: 'title', dir: 'asc' }],
      }),
    ).toThrow(/Unknown sort field/);
  });

  it('binds in/notIn arrays as individual parameters and rejects empty lists', () => {
    const { text, values } = compile({
      entity: 'task',
      filters: {
        logic: 'AND',
        conditions: [{ field: 'status', operator: 'in', value: ['open', 'blocked'] }],
      },
    });
    expect(text).toContain('status::text IN ($2,$3)');
    expect(values).toContain('open');
    expect(values).toContain('blocked');
    expect(() =>
      compile({
        entity: 'task',
        filters: { logic: 'AND', conditions: [{ field: 'status', operator: 'in', value: [] }] },
      }),
    ).toThrow(AnalyticsQueryError);
  });

  it('coerces date filter values and rejects garbage dates', () => {
    const { text, values } = compile({
      entity: 'task',
      filters: {
        logic: 'AND',
        conditions: [{ field: 'dueDate', operator: 'gte', value: '2026-01-01' }],
      },
    });
    expect(text).toContain('due_date >= $2::timestamptz');
    expect(values).toContain('2026-01-01');
    expect(() =>
      compile({
        entity: 'task',
        filters: { logic: 'AND', conditions: [{ field: 'dueDate', operator: 'gte', value: 'tuesday-ish' }] },
      }),
    ).toThrow(AnalyticsQueryError);
  });

  it('rejects unknown entities (goal maps to forecasts, others 400)', () => {
    expect(() => compile({ entity: 'pets' as AnalyticsQuery['entity'] })).toThrow(/Unknown entity/);
    const { text } = compile({ entity: 'goal', aggregates: [{ fn: 'SUM', field: 'amountMicros' }] });
    expect(text).toContain('FROM forecasts');
  });
});
