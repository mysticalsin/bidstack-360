// Serialization + lookup helpers for the analytics dashboard routes.
// Wire format mirrors packages/shared schemas/analytics.ts (useDashboards.ts).
import { Prisma, prisma } from '@bidstack/db';
import {
  AnalyticsWidgetPosition,
  type AnalyticsDashboard,
  type AnalyticsWidget,
  type AnalyticsWidgetType,
} from '@bidstack/shared';

const DEFAULT_POSITION = { x: 0, y: 0, w: 4, h: 3 };

export interface DbDashboard {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  ownerId: string;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbWidget {
  id: string;
  dashboardId: string;
  reportId: string | null;
  title: string;
  type: string;
  config: unknown;
  position: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function parsePosition(value: unknown): { x: number; y: number; w: number; h: number } {
  const parsed = AnalyticsWidgetPosition.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_POSITION;
}

export function serializeWidget(w: DbWidget, latestRunId?: string): AnalyticsWidget {
  const config =
    typeof w.config === 'object' && w.config !== null && !Array.isArray(w.config)
      ? (w.config as Record<string, unknown>)
      : {};
  return {
    id: w.id,
    dashboardId: w.dashboardId,
    reportId: w.reportId ?? undefined,
    title: w.title,
    type: w.type as AnalyticsWidgetType,
    config: latestRunId ? { ...config, latestRunId } : config,
    position: parsePosition(w.position),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

export function serializeDashboard(
  d: DbDashboard,
  widgets?: DbWidget[],
  latestRunByReport?: Map<string, string>,
): AnalyticsDashboard {
  return {
    id: d.id,
    orgId: d.orgId,
    name: d.name,
    description: d.description ?? undefined,
    ownerId: d.ownerId,
    isShared: d.isShared,
    widgets: widgets?.map((w) =>
      serializeWidget(w, w.reportId ? latestRunByReport?.get(w.reportId) : undefined),
    ),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/**
 * Latest persisted run id per report. DISTINCT ON does the per-group top-1
 * in Postgres — Prisma's `distinct` filters in memory after fetching every
 * run row, which is unbounded on busy reports.
 */
export async function latestRunIds(
  orgId: string,
  widgets: DbWidget[],
): Promise<Map<string, string>> {
  const reportIds = [...new Set(widgets.map((w) => w.reportId).filter((id): id is string => !!id))];
  if (reportIds.length === 0) return new Map();
  const runs = await prisma.$queryRaw<Array<{ id: string; report_id: string }>>(
    Prisma.sql`SELECT DISTINCT ON (report_id) id, report_id
               FROM analytics_report_runs
               WHERE org_id = ${orgId}::uuid AND report_id IN (${Prisma.join(reportIds.map((id) => Prisma.sql`${id}::uuid`))})
               ORDER BY report_id, created_at DESC`,
  );
  return new Map(runs.map((r) => [r.report_id, r.id]));
}
