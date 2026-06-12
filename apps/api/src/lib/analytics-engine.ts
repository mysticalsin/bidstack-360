// Analytics query engine — compiles an AnalyticsQuery (shared Zod schema)
// into ONE parameterized SQL statement via Prisma.sql composition.
//
// SECURITY INVARIANTS (non-negotiable):
//   1. Identifiers (table, columns) come ONLY from lib/analytics-fields.ts.
//      Unknown field/sort/groupBy/aggregate keys -> AnalyticsQueryError (400).
//   2. Every value is a bound parameter. No string-concatenated SQL.
//   3. Every query is org-scoped (org_id = $orgId) and soft-delete aware.
//
// The compiler is a pure function so unit tests can assert on the generated
// `.text` / `.values` without touching Postgres.
import { Prisma } from '@bidstack/db';
import type {
  AnalyticsAggregate,
  AnalyticsFilterCondition,
  AnalyticsFilterGroup,
  AnalyticsGroupBy,
  AnalyticsQuery,
} from '@bidstack/shared';

import {
  getEntitySpec,
  getFieldSpec,
  type AnalyticsEntitySpec,
  type AnalyticsFieldSpec,
} from './analytics-fields.js';

/** Raised for any invalid query shape; routes translate it to HTTP 400. */
export class AnalyticsQueryError extends Error {}

export const ANALYTICS_DEFAULT_LIMIT = 100;
export const ANALYTICS_MAX_LIMIT = 1000;
export const ANALYTICS_MAX_FILTER_DEPTH = 5;
export const ANALYTICS_MAX_FILTER_CONDITIONS = 50;
export const ANALYTICS_MAX_IN_VALUES = 200;
export const ANALYTICS_MAX_AGGREGATES = 20;
export const ANALYTICS_MAX_GROUP_BY = 5;
export const ANALYTICS_MAX_SORT = 5;

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Strict numeric literal — Number('') === 0 and Number([]) === 0 would
// otherwise turn garbage filter values into matching predicates.
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
// ISO date or timestamp; Date.parse alone accepts strings Postgres rejects.
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const TIME_BUCKET_SQL: Record<string, string> = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year',
};

function fail(message: string): never {
  throw new AnalyticsQueryError(message);
}

/** Quoted output alias — keys are allowlisted but we re-validate defensively. */
function quoteAlias(alias: string): Prisma.Sql {
  if (!IDENT_RE.test(alias)) fail(`Invalid alias: ${alias}`);
  return Prisma.raw(`"${alias}"`);
}

/** Column expression; Postgres enum columns are cast to text for comparisons/output. */
function columnExpr(field: AnalyticsFieldSpec): Prisma.Sql {
  return Prisma.raw(field.isDbEnum ? `${field.column}::text` : field.column);
}

function requireField(spec: AnalyticsEntitySpec, key: string, ctx: string): AnalyticsFieldSpec {
  const field = getFieldSpec(spec, key);
  if (!field) fail(`Unknown ${ctx} field: ${key}`);
  return field;
}

// ── Value coercion ──────────────────────────────────────────────────────────

function coerceScalar(field: AnalyticsFieldSpec, value: unknown): Prisma.Sql {
  switch (field.type) {
    case 'number': {
      const n =
        typeof value === 'number' && Number.isFinite(value)
          ? value
          : typeof value === 'string' && NUMERIC_RE.test(value.trim())
            ? Number(value.trim())
            : fail(`Field ${field.key} expects a number value`);
      return Prisma.sql`${n}`;
    }
    case 'date': {
      if (
        typeof value !== 'string' ||
        !ISO_DATE_RE.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        value.startsWith('0000') // valid in JS, no year zero in Postgres
      ) {
        fail(`Field ${field.key} expects an ISO date value`);
      }
      // 'YYYY-MM-DD' or full ISO — cast in SQL so date AND timestamptz columns compare.
      return Prisma.sql`${value}::timestamptz`;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return Prisma.sql`${value}`;
      if (value === 'true' || value === 'false') return Prisma.sql`${value === 'true'}`;
      return fail(`Field ${field.key} expects a boolean value`);
    }
    case 'enum': {
      const s = typeof value === 'string' ? value : fail(`Field ${field.key} expects a string`);
      if (field.enumValues && !field.enumValues.includes(s)) {
        fail(`Field ${field.key} expects one of: ${field.enumValues.join(', ')}`);
      }
      return Prisma.sql`${s}`;
    }
    case 'string': {
      if (typeof value === 'string') return Prisma.sql`${value}`;
      if (typeof value === 'number') return Prisma.sql`${String(value)}`;
      fail(`Field ${field.key} expects a string value`);
    }
  }
}

/** Escape ILIKE wildcards so user input matches literally. */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// ── Filters ─────────────────────────────────────────────────────────────────

function isGroup(node: AnalyticsFilterCondition | AnalyticsFilterGroup): node is AnalyticsFilterGroup {
  return typeof node === 'object' && node !== null && 'logic' in node && 'conditions' in node;
}

function buildCondition(spec: AnalyticsEntitySpec, cond: AnalyticsFilterCondition): Prisma.Sql {
  const field = requireField(spec, cond.field, 'filter');
  const col = columnExpr(field);
  switch (cond.operator) {
    case 'eq':
      return Prisma.sql`${col} = ${coerceScalar(field, cond.value)}`;
    case 'neq':
      return Prisma.sql`${col} <> ${coerceScalar(field, cond.value)}`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (field.type === 'boolean') fail(`Operator ${cond.operator} not valid for boolean field ${field.key}`);
      const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[cond.operator];
      return Prisma.sql`${col} ${Prisma.raw(op)} ${coerceScalar(field, cond.value)}`;
    }
    case 'contains':
    case 'startsWith': {
      if (field.type !== 'string' && field.type !== 'enum') {
        fail(`Operator ${cond.operator} only valid for text fields (got ${field.key})`);
      }
      if (typeof cond.value !== 'string') fail(`Operator ${cond.operator} expects a string value`);
      const escaped = escapeLikePattern(cond.value);
      const pattern = cond.operator === 'contains' ? `%${escaped}%` : `${escaped}%`;
      return Prisma.sql`${col} ILIKE ${pattern}`;
    }
    case 'in':
    case 'notIn': {
      if (!Array.isArray(cond.value) || cond.value.length === 0) {
        fail(`Operator ${cond.operator} expects a non-empty array value`);
      }
      if (cond.value.length > ANALYTICS_MAX_IN_VALUES) {
        fail(`Operator ${cond.operator} accepts at most ${ANALYTICS_MAX_IN_VALUES} values`);
      }
      const params = cond.value.map((v) => coerceScalar(field, v));
      const list = Prisma.join(params);
      return cond.operator === 'in'
        ? Prisma.sql`${col} IN (${list})`
        : Prisma.sql`${col} NOT IN (${list})`;
    }
    case 'isNull':
      return Prisma.sql`${Prisma.raw(field.column)} IS NULL`;
    case 'isNotNull':
      return Prisma.sql`${Prisma.raw(field.column)} IS NOT NULL`;
  }
}

interface FilterBudget {
  conditions: number;
}

function buildFilterGroup(
  spec: AnalyticsEntitySpec,
  group: AnalyticsFilterGroup,
  depth: number,
  budget: FilterBudget,
): Prisma.Sql {
  if (depth > ANALYTICS_MAX_FILTER_DEPTH) {
    fail(`Filter tree exceeds max depth of ${ANALYTICS_MAX_FILTER_DEPTH}`);
  }
  if (group.logic !== 'AND' && group.logic !== 'OR') fail('Filter group logic must be AND or OR');
  const parts: Prisma.Sql[] = [];
  for (const node of group.conditions) {
    if (isGroup(node)) {
      parts.push(buildFilterGroup(spec, node, depth + 1, budget));
    } else {
      budget.conditions += 1;
      if (budget.conditions > ANALYTICS_MAX_FILTER_CONDITIONS) {
        fail(`Filter tree exceeds max of ${ANALYTICS_MAX_FILTER_CONDITIONS} conditions`);
      }
      parts.push(buildCondition(spec, node));
    }
  }
  // An empty group has no defensible identity element (TRUE silently widens
  // OR groups); reject so the client fixes the query instead.
  if (parts.length === 0) fail('Filter groups must contain at least one condition');
  const joiner = group.logic === 'AND' ? ' AND ' : ' OR ';
  return Prisma.sql`(${Prisma.join(parts, joiner)})`;
}

// ── Aggregates + group by ───────────────────────────────────────────────────

function aggregateExpr(spec: AnalyticsEntitySpec, agg: AnalyticsAggregate): Prisma.Sql {
  if (agg.fn === 'COUNT' && agg.field === '*') return Prisma.raw('COUNT(*)::int');
  const field = requireField(spec, agg.field, 'aggregate');
  const col = Prisma.raw(field.column);
  switch (agg.fn) {
    case 'COUNT':
      return Prisma.sql`COUNT(${col})::int`;
    case 'COUNT_DISTINCT':
      return Prisma.sql`COUNT(DISTINCT ${col})::int`;
    // float8 contract: exact for |value| < 2^53. Money columns store micros,
    // so SUMs stay exact below ~9.0e15 micros (≈ €9 billion) — far above any
    // realistic org pipeline. Revisit (::text serialization) if that changes.
    case 'SUM': {
      if (field.type !== 'number') fail(`${agg.fn} requires a numeric field (got ${agg.field})`);
      // Zero matching rows means SUM is NULL in SQL; KPI tiles expect 0.
      return Prisma.sql`COALESCE(SUM(${col}), 0)::float8`;
    }
    case 'AVG': {
      if (field.type !== 'number') fail(`${agg.fn} requires a numeric field (got ${agg.field})`);
      // AVG of zero rows is deliberately NULL — 0 would be a lie.
      return Prisma.sql`AVG(${col})::float8`;
    }
    case 'MIN':
    case 'MAX': {
      if (field.type === 'number') return Prisma.sql`${Prisma.raw(agg.fn)}(${col})::float8`;
      if (field.type === 'date') return Prisma.sql`${Prisma.raw(agg.fn)}(${col})`;
      fail(`${agg.fn} requires a numeric or date field (got ${agg.field})`);
    }
  }
}

function aggregateAlias(agg: AnalyticsAggregate, isOnlyAggregate: boolean): string {
  if (agg.alias) {
    if (!IDENT_RE.test(agg.alias)) fail(`Invalid aggregate alias: ${agg.alias}`);
    return agg.alias;
  }
  // Widget contract: KPI tiles read rows[0].value and chart series read
  // row.value next to the group key — a lone unaliased aggregate is 'value'
  // whether or not the query groups.
  if (isOnlyAggregate) return 'value';
  const fieldPart = agg.field === '*' ? 'all' : agg.field;
  return `${agg.fn}_${fieldPart}`.toLowerCase();
}

/** Validate an IANA zone against the runtime zone database (no allowlist drift). */
function requireTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return fail(`Unknown timezone: ${tz}`);
  }
}

function groupByExpr(spec: AnalyticsEntitySpec, g: AnalyticsGroupBy, timezone?: string): Prisma.Sql {
  const field = requireField(spec, g.field, 'groupBy');
  if (g.timeBucket) {
    if (field.type !== 'date') fail(`timeBucket requires a date field (got ${g.field})`);
    if (!Object.prototype.hasOwnProperty.call(TIME_BUCKET_SQL, g.timeBucket)) {
      fail(`Unknown time bucket: ${g.timeBucket}`);
    }
    // Bucket name rides as a bound text parameter — date_trunc(text, ts).
    const bucket = TIME_BUCKET_SQL[g.timeBucket]!;
    const col = Prisma.raw(field.column);
    if (timezone) {
      // AT TIME ZONE so week/month boundaries land on the user's local
      // midnight, not UTC's. Result is a tz-naive local timestamp.
      return Prisma.sql`date_trunc(${bucket}::text, ${col} AT TIME ZONE ${requireTimezone(timezone)})`;
    }
    return Prisma.sql`date_trunc(${bucket}::text, ${col})`;
  }
  return columnExpr(field);
}

// ── Compiler ────────────────────────────────────────────────────────────────

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return ANALYTICS_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), ANALYTICS_MAX_LIMIT);
}

interface SelectPlan {
  selectParts: Prisma.Sql[];
  groupExprs: Prisma.Sql[];
  groupAliases: string[];
  emittedAliases: Set<string>;
  hasAggregates: boolean;
}

/** SELECT list + GROUP BY expressions; every alias tracked for sort validation. */
function buildSelectPlan(spec: AnalyticsEntitySpec, query: AnalyticsQuery): SelectPlan {
  // GroupBy without aggregates is invalid SQL — give it the chart-friendly
  // meaning (count of rows per group) instead of erroring.
  const aggregates =
    (query.aggregates?.length ?? 0) === 0 && (query.groupBy?.length ?? 0) > 0
      ? [{ fn: 'COUNT', field: '*', alias: 'value' } as AnalyticsAggregate]
      : (query.aggregates ?? []);
  if (aggregates.length > ANALYTICS_MAX_AGGREGATES) {
    fail(`Queries accept at most ${ANALYTICS_MAX_AGGREGATES} aggregates`);
  }
  const groupBy = query.groupBy ?? [];
  if (groupBy.length > ANALYTICS_MAX_GROUP_BY) {
    fail(`Queries accept at most ${ANALYTICS_MAX_GROUP_BY} groupBy fields`);
  }

  const plan: SelectPlan = {
    selectParts: [],
    groupExprs: [],
    groupAliases: [],
    emittedAliases: new Set(),
    hasAggregates: aggregates.length > 0,
  };
  const addAlias = (alias: string): void => {
    if (plan.emittedAliases.has(alias)) fail(`Duplicate output alias: ${alias}`);
    plan.emittedAliases.add(alias);
  };

  if (aggregates.length > 0) {
    for (const g of groupBy) {
      addAlias(g.field);
      const expr = groupByExpr(spec, g, query.timezone);
      plan.groupExprs.push(expr);
      plan.groupAliases.push(g.field);
      plan.selectParts.push(Prisma.sql`${expr} AS ${quoteAlias(g.field)}`);
    }
    for (const agg of aggregates) {
      const alias = aggregateAlias(agg, aggregates.length === 1);
      addAlias(alias);
      plan.selectParts.push(Prisma.sql`${aggregateExpr(spec, agg)} AS ${quoteAlias(alias)}`);
    }
  } else {
    // Plain row select: every allowlisted column, aliased by its key.
    for (const field of spec.fields) {
      addAlias(field.key);
      plan.selectParts.push(Prisma.sql`${columnExpr(field)} AS ${quoteAlias(field.key)}`);
    }
  }
  return plan;
}

function buildOrderBy(query: AnalyticsQuery, plan: SelectPlan): Prisma.Sql[] {
  const sort = query.sort ?? [];
  if (sort.length > ANALYTICS_MAX_SORT) {
    fail(`Queries accept at most ${ANALYTICS_MAX_SORT} sort fields`);
  }
  const orderParts: Prisma.Sql[] = [];
  for (const s of sort) {
    if (!plan.emittedAliases.has(s.field)) fail(`Unknown sort field: ${s.field}`);
    if (s.dir !== 'asc' && s.dir !== 'desc') fail('Sort dir must be asc or desc');
    orderParts.push(Prisma.sql`${quoteAlias(s.field)} ${Prisma.raw(s.dir.toUpperCase())}`);
  }
  if (orderParts.length === 0) {
    if (plan.groupAliases.length > 0) {
      // Grouped results must be deterministic — time series in bucket order,
      // categorical groups in key order — or LIMIT truncates arbitrarily.
      for (const alias of plan.groupAliases) {
        orderParts.push(Prisma.sql`${quoteAlias(alias)} ASC`);
      }
    } else if (!plan.hasAggregates && plan.emittedAliases.has('createdAt')) {
      // Deterministic default ordering for plain row selects.
      orderParts.push(Prisma.sql`"createdAt" DESC`);
    }
  }
  return orderParts;
}

/**
 * Compile an AnalyticsQuery into a single parameterized SQL statement.
 * Throws AnalyticsQueryError (-> 400) on any field outside the allowlist.
 */
export function compileAnalyticsQuery(orgId: string, query: AnalyticsQuery): Prisma.Sql {
  const spec = getEntitySpec(query.entity) ?? fail(`Unknown entity: ${query.entity}`);
  const plan = buildSelectPlan(spec, query);

  const where: Prisma.Sql[] = [Prisma.sql`org_id = ${orgId}::uuid`];
  if (spec.softDelete) where.push(Prisma.sql`deleted_at IS NULL`);
  // An empty TOP-LEVEL group is the builder UI's "no filters yet" shape —
  // treat it as absent. Empty nested groups still reject in buildFilterGroup.
  if (query.filters && query.filters.conditions.length > 0) {
    where.push(buildFilterGroup(spec, query.filters, 1, { conditions: 0 }));
  }
  const orderParts = buildOrderBy(query, plan);

  let sql = Prisma.sql`SELECT ${Prisma.join(plan.selectParts)} FROM ${Prisma.raw(spec.table)} WHERE ${Prisma.join(where, ' AND ')}`;
  if (plan.groupExprs.length > 0) sql = Prisma.sql`${sql} GROUP BY ${Prisma.join(plan.groupExprs)}`;
  if (orderParts.length > 0) sql = Prisma.sql`${sql} ORDER BY ${Prisma.join(orderParts)}`;
  return Prisma.sql`${sql} LIMIT ${clampLimit(query.limit)}`;
}

// ── Result normalization ────────────────────────────────────────────────────

/**
 * Make raw driver rows JSON-safe: BigInt (bigint cols), Date (timestamptz),
 * and Prisma.Decimal (numeric) are not storable in a Json column as-is.
 */
export function normalizeAnalyticsRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'bigint') out[key] = Number(value);
      else if (value instanceof Date) out[key] = value.toISOString();
      else if (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as { toNumber?: unknown }).toNumber === 'function'
      ) {
        out[key] = (value as { toNumber: () => number }).toNumber();
      } else out[key] = value;
    }
    return out;
  });
}
