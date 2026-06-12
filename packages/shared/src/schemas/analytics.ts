// Analytics report builder — wire schemas shared by apps/api and the
// apps/web hooks (useAnalyticsReports.ts / useDashboards.ts are the binding
// contract; these schemas mirror their types exactly).
//
// All names carry the `Analytics` prefix to avoid collisions with the legacy
// crm.dashboard.ts DashboardWidget exports (shared/index re-exports `*`).
import { z } from 'zod';

export const AnalyticsEntityType = z.enum([
  'lead',
  'opportunity',
  'contact',
  'company',
  'task',
  'activity',
  'goal',
]);
export type AnalyticsEntityType = z.infer<typeof AnalyticsEntityType>;

export const AnalyticsAggregateFn = z.enum([
  'COUNT',
  'COUNT_DISTINCT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
]);
export type AnalyticsAggregateFn = z.infer<typeof AnalyticsAggregateFn>;

export const AnalyticsFilterOperator = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'in',
  'notIn',
  'isNull',
  'isNotNull',
]);
export type AnalyticsFilterOperator = z.infer<typeof AnalyticsFilterOperator>;

export const AnalyticsTimeBucket = z.enum(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']);
export type AnalyticsTimeBucket = z.infer<typeof AnalyticsTimeBucket>;

export const AnalyticsChartType = z.enum([
  'table',
  'line',
  'bar',
  'area',
  'pie',
  'donut',
  'funnel',
  'gauge',
  'heatmap',
  'scatter',
  'radar',
]);
export type AnalyticsChartType = z.infer<typeof AnalyticsChartType>;

// Widget types = chart types + 'kpi' (single-value tile).
export const AnalyticsWidgetType = z.enum([
  'kpi',
  'line',
  'bar',
  'area',
  'pie',
  'donut',
  'funnel',
  'gauge',
  'heatmap',
  'scatter',
  'radar',
  'table',
]);
export type AnalyticsWidgetType = z.infer<typeof AnalyticsWidgetType>;

export const AnalyticsFilterCondition = z.object({
  // Frontend sends a client-side stable key for list animations; ignored server-side.
  id: z.string().optional(),
  field: z.string().min(1).max(100),
  operator: AnalyticsFilterOperator,
  value: z.unknown().optional(),
});
export type AnalyticsFilterCondition = z.infer<typeof AnalyticsFilterCondition>;

export interface AnalyticsFilterGroup {
  id?: string;
  logic: 'AND' | 'OR';
  conditions: Array<AnalyticsFilterCondition | AnalyticsFilterGroup>;
}

// WHY z.lazy + explicit type annotation: the filter tree is recursive
// (groups nest groups); zod cannot infer recursive types without help.
export const AnalyticsFilterGroup: z.ZodType<AnalyticsFilterGroup> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    logic: z.enum(['AND', 'OR']),
    conditions: z.array(z.union([AnalyticsFilterCondition, AnalyticsFilterGroup])),
  }),
);

export const AnalyticsAggregate = z.object({
  fn: AnalyticsAggregateFn,
  field: z.string().min(1).max(100),
  alias: z.string().max(100).optional(),
});
export type AnalyticsAggregate = z.infer<typeof AnalyticsAggregate>;

export const AnalyticsGroupBy = z.object({
  field: z.string().min(1).max(100),
  timeBucket: AnalyticsTimeBucket.optional(),
});
export type AnalyticsGroupBy = z.infer<typeof AnalyticsGroupBy>;

export const AnalyticsSortField = z.object({
  field: z.string().min(1).max(100),
  dir: z.enum(['asc', 'desc']),
});
export type AnalyticsSortField = z.infer<typeof AnalyticsSortField>;

export const AnalyticsQuery = z.object({
  entity: AnalyticsEntityType,
  filters: AnalyticsFilterGroup.optional(),
  // Caps bound the compiled SQL size; the engine re-checks them so stored
  // queries written before these limits still fail closed at run time.
  aggregates: z.array(AnalyticsAggregate).max(20).optional(),
  groupBy: z.array(AnalyticsGroupBy).max(5).optional(),
  sort: z.array(AnalyticsSortField).max(5).optional(),
  limit: z.number().int().positive().optional(),
  // IANA zone for date_trunc bucketing (e.g. 'Europe/Paris'); engine
  // validates it against the runtime's zone database. Default: UTC.
  timezone: z.string().max(64).optional(),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

export const AnalyticsReport = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  ownerId: z.string().uuid(),
  query: AnalyticsQuery,
  chartType: AnalyticsChartType,
  schedule: z.string().optional(),
  lastRunAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AnalyticsReport = z.infer<typeof AnalyticsReport>;

export const AnalyticsReportRunStatus = z.enum(['pending', 'running', 'done', 'error']);
export type AnalyticsReportRunStatus = z.infer<typeof AnalyticsReportRunStatus>;

export const AnalyticsReportRun = z.object({
  id: z.string().uuid(),
  // '' for ephemeral preview runs (not persisted), per the frontend contract.
  reportId: z.string(),
  status: AnalyticsReportRunStatus,
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  rowCount: z.number().int().optional(),
  result: z.array(z.record(z.unknown())).optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type AnalyticsReportRun = z.infer<typeof AnalyticsReportRun>;

export const AnalyticsReportCreate = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  query: AnalyticsQuery,
  chartType: AnalyticsChartType.default('table'),
  schedule: z.string().max(255).optional(),
});
export type AnalyticsReportCreate = z.infer<typeof AnalyticsReportCreate>;

export const AnalyticsReportPatch = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).nullable().optional(),
    query: AnalyticsQuery.optional(),
    chartType: AnalyticsChartType.optional(),
    schedule: z.string().max(255).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type AnalyticsReportPatch = z.infer<typeof AnalyticsReportPatch>;

export const AnalyticsWidgetPosition = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});
export type AnalyticsWidgetPosition = z.infer<typeof AnalyticsWidgetPosition>;

export const AnalyticsWidget = z.object({
  id: z.string().uuid(),
  dashboardId: z.string().uuid(),
  reportId: z.string().uuid().optional(),
  title: z.string(),
  type: AnalyticsWidgetType,
  config: z.record(z.unknown()),
  position: AnalyticsWidgetPosition,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AnalyticsWidget = z.infer<typeof AnalyticsWidget>;

export const AnalyticsDashboard = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  ownerId: z.string().uuid(),
  isShared: z.boolean(),
  widgets: z.array(AnalyticsWidget).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AnalyticsDashboard = z.infer<typeof AnalyticsDashboard>;

export const AnalyticsDashboardCreate = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  isShared: z.boolean().default(false),
});
export type AnalyticsDashboardCreate = z.infer<typeof AnalyticsDashboardCreate>;

export const AnalyticsDashboardPatch = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).nullable().optional(),
    isShared: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type AnalyticsDashboardPatch = z.infer<typeof AnalyticsDashboardPatch>;

export const AnalyticsWidgetCreate = z.object({
  reportId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(255),
  type: AnalyticsWidgetType,
  config: z.record(z.unknown()).default({}),
  position: AnalyticsWidgetPosition.default({ x: 0, y: 0, w: 4, h: 3 }),
});
export type AnalyticsWidgetCreate = z.infer<typeof AnalyticsWidgetCreate>;

export const AnalyticsWidgetPatch = z
  .object({
    reportId: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(255).optional(),
    type: AnalyticsWidgetType.optional(),
    config: z.record(z.unknown()).optional(),
    position: AnalyticsWidgetPosition.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type AnalyticsWidgetPatch = z.infer<typeof AnalyticsWidgetPatch>;

export const AnalyticsFieldDef = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['string', 'number', 'date', 'boolean', 'enum']),
  enumValues: z.array(z.string()).optional(),
});
export type AnalyticsFieldDef = z.infer<typeof AnalyticsFieldDef>;
