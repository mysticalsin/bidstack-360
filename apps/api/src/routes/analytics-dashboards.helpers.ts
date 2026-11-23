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

/** Owner or org admin. Shared by the canEdit field and requireDashboardEditor. */
export function canEditDashboard(ownerId: string, userId: string, isAdmin: boolean): boolean {
  return ownerId === userId || isAdmin;
}

/**
 * System Admin, the same predicate the dashboard canEdit flag uses.
 * A role that is only named Admin does not qualify (isSystem must be true),
 * and a revoked assignment (deletedAt set) does not count.
 */
export async function userIsSystemAdmin(orgId: string, userId: string): Promise<boolean> {
  const adminRoleCount = await prisma.userRole.count({
    where: {
      userId,
      deletedAt: null,
      user: { orgId, deletedAt: null },
      role: { orgId, name: 'Admin', isSystem: true, deletedAt: null },
    },
  });
  return adminRoleCount > 0;
}

const REFERENCING_WIDGET_PAGE = 1000;

/**
 * PATCH, DELETE, and a persisted run change what every widget pointing at
 * the report shows. reports:write is not enough: the caller must canEdit
 * every live dashboard that references it. A report with no live widget
 * reference has nothing to protect. Soft-deleted dashboards are not showing
 * the report, so they do not count.
 */
export async function callerCanEditEveryReferencingDashboard(
  orgId: string,
  userId: string,
  reportId: string,
): Promise<boolean> {
  let admin: boolean | undefined;
  let cursor: { id: string } | undefined;
  let page: Array<{ id: string; dashboard: { ownerId: string } }>;
  do {
    page = await prisma.analyticsDashboardWidget.findMany({
      where: {
        orgId,
        reportId,
        dashboard: { orgId, deletedAt: null },
      },
      select: { id: true, dashboard: { select: { ownerId: true } } },
      orderBy: { id: 'asc' },
      take: REFERENCING_WIDGET_PAGE,
      ...(cursor ? { skip: 1, cursor } : {}),
    });
    for (const row of page) {
      // Owner short-circuit avoids the admin lookup when every board is theirs.
      if (canEditDashboard(row.dashboard.ownerId, userId, false)) continue;
      if (admin === undefined) admin = await userIsSystemAdmin(orgId, userId);
      if (!canEditDashboard(row.dashboard.ownerId, userId, admin)) return false;
    }
    const last = page[page.length - 1];
    cursor = last ? { id: last.id } : cursor;
  } while (page.length === REFERENCING_WIDGET_PAGE);
  return true;
}

export function serializeDashboard(
  d: DbDashboard,
  widgets: DbWidget[] | undefined,
  latestRunByReport: Map<string, string> | undefined,
  canEdit: boolean,
): AnalyticsDashboard {
  return {
    id: d.id,
    orgId: d.orgId,
    name: d.name,
    description: d.description ?? undefined,
    ownerId: d.ownerId,
    isShared: d.isShared,
    canEdit,
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
