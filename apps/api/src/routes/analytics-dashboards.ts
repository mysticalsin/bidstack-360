// Analytics dashboards + widgets — backs apps/web useDashboards.ts.
//
// Visibility: dashboards are org-scoped; non-shared (isShared=false)
// dashboards are only visible to their owner or members holding the seeded
// "Admin" role (same UserRole check as routes/tasks.ts — no claim fallback).
//
// widget.config.latestRunId is COMPUTED on read (latest persisted run for
// widget.reportId, one grouped query) — never stored.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  AnalyticsDashboard,
  AnalyticsDashboardCreate,
  AnalyticsDashboardPatch,
  AnalyticsWidget,
  AnalyticsWidgetCreate,
  AnalyticsWidgetPatch,
} from '@bidstack/shared';

import {
  latestRunIds,
  serializeDashboard,
  serializeWidget,
  type DbDashboard,
} from './analytics-dashboards.helpers.js';

const IdParam = z.object({ id: z.string().uuid() });
const WidgetParams = z.object({ id: z.string().uuid(), widgetId: z.string().uuid() });

export const analyticsDashboardsRoutes: FastifyPluginAsyncZod = async (server) => {
  async function isOrgAdmin(req: FastifyRequest): Promise<boolean> {
    const adminRoleCount = await prisma.userRole.count({
      where: {
        userId: req.auth.userId,
        // Revocation soft-deletes the assignment row; without this filter a
        // revoked Admin keeps read/edit/delete on every private dashboard in
        // the org. Same omission as lib/rbac-decision-cache.ts had.
        deletedAt: null,
        user: { orgId: req.auth.orgId, deletedAt: null },
        role: { orgId: req.auth.orgId, name: 'Admin', deletedAt: null },
      },
    });
    return adminRoleCount > 0;
  }

  /** Org-scoped fetch honoring the shared/owner/admin visibility rule. 404s otherwise. */
  async function findVisibleDashboard(req: FastifyRequest, id: string): Promise<DbDashboard> {
    const dashboard = await prisma.analyticsDashboard.findFirst({
      where: { id, orgId: req.auth.orgId, deletedAt: null },
    });
    if (!dashboard) throw server.httpErrors.notFound('Dashboard not found');
    if (!dashboard.isShared && dashboard.ownerId !== req.auth.userId && !(await isOrgAdmin(req))) {
      // 404 (not 403) so non-owners cannot probe for private dashboard ids.
      throw server.httpErrors.notFound('Dashboard not found');
    }
    return dashboard;
  }

  /** Owner-or-admin gate shared by dashboard PATCH/DELETE and ALL widget mutations. */
  async function requireDashboardEditor(req: FastifyRequest, dashboard: DbDashboard): Promise<void> {
    if (dashboard.ownerId !== req.auth.userId && !(await isOrgAdmin(req))) {
      throw server.httpErrors.forbidden('Only the owner or an admin can modify this dashboard');
    }
  }

  server.get(
    '/dashboards',
    { schema: { response: { 200: z.array(AnalyticsDashboard) } } },
    async (req) => {
      const admin = await isOrgAdmin(req);
      const dashboards = await prisma.analyticsDashboard.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(admin ? {} : { OR: [{ isShared: true }, { ownerId: req.auth.userId }] }),
        },
        include: { widgets: { orderBy: { createdAt: 'asc' }, take: 200 } },
        orderBy: { createdAt: 'desc' },
        // Bounded reads (query-guard): org dashboard sets are admin-curated.
        take: 200,
      });
      const allWidgets = dashboards.flatMap((d) => d.widgets);
      const latest = await latestRunIds(req.auth.orgId, allWidgets);
      return dashboards.map((d) => serializeDashboard(d, d.widgets, latest));
    },
  );

  server.post(
    '/dashboards',
    {
      preHandler: [server.requirePermission('reports:write')],
      schema: { body: AnalyticsDashboardCreate, response: { 201: AnalyticsDashboard } },
    },
    async (req, reply) => {
      const created = await prisma.analyticsDashboard.create({
        data: {
          orgId: req.auth.orgId,
          ownerId: req.auth.userId,
          name: req.body.name,
          description: req.body.description ?? null,
          isShared: req.body.isShared,
        },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'analytics_dashboard.create',
          targetType: 'analytics_dashboard',
          targetId: created.id,
          diff: { name: created.name, isShared: created.isShared },
        },
      });
      return reply.code(201).send(serializeDashboard(created, []));
    },
  );

  server.get(
    '/dashboards/:id',
    { schema: { params: IdParam, response: { 200: AnalyticsDashboard } } },
    async (req) => {
      const dashboard = await findVisibleDashboard(req, req.params.id);
      const widgets = await prisma.analyticsDashboardWidget.findMany({
        where: { dashboardId: dashboard.id, orgId: req.auth.orgId },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const latest = await latestRunIds(req.auth.orgId, widgets);
      return serializeDashboard(dashboard, widgets, latest);
    },
  );

  server.patch(
    '/dashboards/:id',
    {
      preHandler: [server.requirePermission('reports:write')],
      schema: { params: IdParam, body: AnalyticsDashboardPatch, response: { 200: AnalyticsDashboard } },
    },
    async (req) => {
      const dashboard = await findVisibleDashboard(req, req.params.id);
      await requireDashboardEditor(req, dashboard);
      await prisma.analyticsDashboard.updateMany({
        where: { id: dashboard.id, orgId: req.auth.orgId, deletedAt: null },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.isShared !== undefined ? { isShared: req.body.isShared } : {}),
        },
      });
      const updated = await prisma.analyticsDashboard.findFirstOrThrow({
        where: { id: dashboard.id, orgId: req.auth.orgId, deletedAt: null },
        include: { widgets: { orderBy: { createdAt: 'asc' }, take: 200 } },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'analytics_dashboard.update',
          targetType: 'analytics_dashboard',
          targetId: updated.id,
          diff: req.body as object,
        },
      });
      const latest = await latestRunIds(req.auth.orgId, updated.widgets);
      return serializeDashboard(updated, updated.widgets, latest);
    },
  );

  server.delete(
    '/dashboards/:id',
    {
      preHandler: [server.requirePermission('reports:write')],
      schema: { params: IdParam, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const dashboard = await findVisibleDashboard(req, req.params.id);
      await requireDashboardEditor(req, dashboard);
      await prisma.$transaction([
        prisma.analyticsDashboard.updateMany({
          where: { id: dashboard.id, orgId: req.auth.orgId, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'analytics_dashboard.delete',
            targetType: 'analytics_dashboard',
            targetId: dashboard.id,
            diff: { name: dashboard.name },
          },
        }),
      ]);
      return reply.code(204).send(null);
    },
  );

  server.get(
    '/dashboards/:id/widgets',
    { schema: { params: IdParam, response: { 200: z.array(AnalyticsWidget) } } },
    async (req) => {
      const dashboard = await findVisibleDashboard(req, req.params.id);
      const widgets = await prisma.analyticsDashboardWidget.findMany({
        where: { dashboardId: dashboard.id, orgId: req.auth.orgId },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const latest = await latestRunIds(req.auth.orgId, widgets);
      return widgets.map((w) =>
        serializeWidget(w, w.reportId ? latest.get(w.reportId) : undefined),
      );
    },
  );

  server.post(
    '/dashboards/:id/widgets',
    {
      preHandler: [server.requirePermission('reports:write')],
      schema: { params: IdParam, body: AnalyticsWidgetCreate, response: { 201: AnalyticsWidget } },
    },
    async (req, reply) => {
      const dashboard = await findVisibleDashboard(req, req.params.id);
      await requireDashboardEditor(req, dashboard);
      if (req.body.reportId) {
        const report = await prisma.analyticsReport.findFirst({
          where: { id: req.body.reportId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!report) throw server.httpErrors.badRequest('Report not found in this org');
      }
      const created = await prisma.analyticsDashboardWidget.create({
        data: {
          orgId: req.auth.orgId,
          dashboardId: dashboard.id,
          reportId: req.body.reportId ?? null,
          title: req.body.title,
          type: req.body.type,
          config: req.body.config as object,
          position: req.body.position,
        },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'analytics_widget.create',
          targetType: 'analytics_widget',
          targetId: created.id,
          diff: { title: created.title, type: created.type, dashboardId: dashboard.id },
        },
      });
      const latest = await latestRunIds(req.auth.orgId, [created]);
      return reply
        .code(201)
        .send(serializeWidget(created, created.reportId ? latest.get(created.reportId) : undefined));
    },
  );

  server.patch(
    '/dashboards/:id/widgets/:widgetId',
    {
      preHandler: [server.requirePermission('reports:write')],
      schema: { params: WidgetParams, body: AnalyticsWidgetPatch, response: { 200: AnalyticsWidget } },
    },
    async (req) => {
      const dashboard = await findVisibleDashboard(req, req.params.id);
      await requireDashboardEditor(req, dashboard);
      const existing = await prisma.analyticsDashboardWidget.findFirst({
        where: { id: req.params.widgetId, dashboardId: dashboard.id, orgId: req.auth.orgId },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Widget not found');
      if (req.body.reportId) {
        const report = await prisma.analyticsReport.findFirst({
          where: { id: req.body.reportId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!report) throw server.httpErrors.badRequest('Report not found in this org');
      }
      await prisma.analyticsDashboardWidget.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId },
        data: {
          ...(req.body.reportId !== undefined ? { reportId: req.body.reportId } : {}),
          ...(req.body.title !== undefined ? { title: req.body.title } : {}),
          ...(req.body.type !== undefined ? { type: req.body.type } : {}),
          ...(req.body.config !== undefined ? { config: req.body.config as object } : {}),
          ...(req.body.position !== undefined ? { position: req.body.position } : {}),
        },
      });
      const updated = await prisma.analyticsDashboardWidget.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'analytics_widget.update',
          targetType: 'analytics_widget',
          targetId: updated.id,
          diff: req.body as object,
        },
      });
      const latest = await latestRunIds(req.auth.orgId, [updated]);
      return serializeWidget(updated, updated.reportId ? latest.get(updated.reportId) : undefined);
    },
  );

  server.delete(
    '/dashboards/:id/widgets/:widgetId',
    {
      preHandler: [server.requirePermission('reports:write')],
      schema: { params: WidgetParams, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const dashboard = await findVisibleDashboard(req, req.params.id);
      await requireDashboardEditor(req, dashboard);
      const existing = await prisma.analyticsDashboardWidget.findFirst({
        where: { id: req.params.widgetId, dashboardId: dashboard.id, orgId: req.auth.orgId },
        select: { id: true, title: true },
      });
      if (!existing) throw server.httpErrors.notFound('Widget not found');
      await prisma.$transaction([
        prisma.analyticsDashboardWidget.deleteMany({
          where: { id: existing.id, orgId: req.auth.orgId },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'analytics_widget.delete',
            targetType: 'analytics_widget',
            targetId: existing.id,
            diff: { title: existing.title },
          },
        }),
      ]);
      return reply.code(204).send(null);
    },
  );
};
