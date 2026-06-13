// Analytics report builder routes — backs apps/web useAnalyticsReports.ts.
//
// Collision note: routes/reports.ts owns the static GET /reports/{pipeline,
// sales-intelligence,leads,service-desk,tasks} endpoints. All param routes
// here validate :id as uuid, and Fastify always prefers static segments, so
// the legacy routes keep winning their paths.
import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  AnalyticsFieldDef,
  AnalyticsQuery,
  AnalyticsReport,
  AnalyticsReportCreate,
  AnalyticsReportPatch,
  AnalyticsReportRun,
} from '@bidstack/shared';

import { AnalyticsQueryError, compileAnalyticsQuery } from '../lib/analytics-engine.js';
import { getEntitySpec } from '../lib/analytics-fields.js';
import {
  executeAnalyticsQuery,
  runPersistedReport,
  serializeReport,
  serializeRun,
} from './analytics-reports.helpers.js';

const IdParam = z.object({ id: z.string().uuid() });

export const analyticsReportsRoutes: FastifyPluginAsyncZod = async (server) => {
  /** Dry-compile so invalid queries are rejected at save time, not run time. */
  function validateQuery(orgId: string, query: AnalyticsQuery): void {
    try {
      compileAnalyticsQuery(orgId, query);
    } catch (err) {
      if (err instanceof AnalyticsQueryError) throw server.httpErrors.badRequest(err.message);
      throw err;
    }
  }

  server.get(
    '/entities/:type/fields',
    { preHandler: [server.requirePermission('reports:read')],  schema: { params: z.object({ type: z.string() }), response: { 200: z.array(AnalyticsFieldDef) } } },
    async (req) => {
      const spec = getEntitySpec(req.params.type);
      if (!spec) throw server.httpErrors.notFound(`Unknown entity: ${req.params.type}`);
      return spec.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        enumValues: f.enumValues,
      }));
    },
  );

  server.get(
    '/reports',
    {
      preHandler: [server.requirePermission('reports:read')],
      schema: { response: { 200: z.array(AnalyticsReport) } },
    },
    async (req) => {
      const reports = await prisma.analyticsReport.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        // Bounded read (query-guard rejects unbounded findMany): saved
        // reports are org-curated artifacts, 200 covers any real org.
        take: 200,
      });
      return reports.map(serializeReport);
    },
  );

  server.post(
    '/reports',
    {
      preHandler: [server.requirePermission('reports:write')],
      schema: { body: AnalyticsReportCreate, response: { 201: AnalyticsReport } },
    },
    async (req, reply) => {
      validateQuery(req.auth.orgId, req.body.query);
      const created = await prisma.analyticsReport.create({
        data: {
          orgId: req.auth.orgId,
          ownerId: req.auth.userId,
          name: req.body.name,
          description: req.body.description ?? null,
          query: req.body.query as object,
          chartType: req.body.chartType,
          schedule: req.body.schedule ?? null,
        },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'analytics_report.create',
          targetType: 'analytics_report',
          targetId: created.id,
          diff: { name: created.name, entity: req.body.query.entity },
        },
      });
      return reply.code(201).send(serializeReport(created));
    },
  );

  server.get(
    '/reports/:id',
    {
      preHandler: [server.requirePermission('reports:read')],
      schema: { params: IdParam, response: { 200: AnalyticsReport } },
    },
    async (req) => {
      const report = await prisma.analyticsReport.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!report) throw server.httpErrors.notFound('Report not found');
      return serializeReport(report);
    },
  );

  server.patch(
    '/reports/:id',
    {
      preHandler: [server.requirePermission('reports:write')],
      schema: { params: IdParam, body: AnalyticsReportPatch, response: { 200: AnalyticsReport } },
    },
    async (req) => {
      const existing = await prisma.analyticsReport.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Report not found');
      if (req.body.query) validateQuery(req.auth.orgId, req.body.query);

      await prisma.analyticsReport.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.description !== undefined ? { description: req.body.description } : {}),
          ...(req.body.query !== undefined ? { query: req.body.query as object } : {}),
          ...(req.body.chartType !== undefined ? { chartType: req.body.chartType } : {}),
          ...(req.body.schedule !== undefined ? { schedule: req.body.schedule } : {}),
        },
      });
      const updated = await prisma.analyticsReport.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'analytics_report.update',
          targetType: 'analytics_report',
          targetId: updated.id,
          diff: req.body as object,
        },
      });
      return serializeReport(updated);
    },
  );

  server.post(
    '/reports/:id/duplicate',
    {
      preHandler: [server.requirePermission('reports:write')],
      schema: { params: IdParam, response: { 201: AnalyticsReport } },
    },
    async (req, reply) => {
      const source = await prisma.analyticsReport.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!source) throw server.httpErrors.notFound('Report not found');
      const copy = await prisma.analyticsReport.create({
        data: {
          orgId: req.auth.orgId,
          ownerId: req.auth.userId,
          name: `${source.name} (copy)`,
          description: source.description,
          query: source.query as object,
          chartType: source.chartType,
          schedule: null,
        },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'analytics_report.create',
          targetType: 'analytics_report',
          targetId: copy.id,
          diff: { name: copy.name, duplicatedFrom: source.id },
        },
      });
      return reply.code(201).send(serializeReport(copy));
    },
  );

  server.delete(
    '/reports/:id',
    {
      preHandler: [server.requirePermission('reports:write')],
      schema: { params: IdParam, response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await prisma.analyticsReport.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!existing) throw server.httpErrors.notFound('Report not found');
      await prisma.$transaction([
        prisma.analyticsReport.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
        // Soft delete never fires the FK's onDelete: SetNull — unlink widgets
        // here so dashboards stop referencing a report that no longer reads.
        prisma.analyticsDashboardWidget.updateMany({
          where: { reportId: existing.id, orgId: req.auth.orgId },
          data: { reportId: null },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'analytics_report.delete',
            targetType: 'analytics_report',
            targetId: existing.id,
            diff: { name: existing.name },
          },
        }),
      ]);
      return reply.code(204).send(null);
    },
  );

  // Preview run — executes an unsaved query, returns an ephemeral run object.
  // Nothing is persisted; reportId is '' per the frontend contract.
  server.post(
    '/reports/run',
    { preHandler: [server.requirePermission('reports:read')], 
      schema: {
        body: z.object({ query: AnalyticsQuery }),
        response: { 200: AnalyticsReportRun },
      },
    },
    async (req) => {
      const startedAt = new Date().toISOString();
      let rows: Array<Record<string, unknown>>;
      try {
        rows = await executeAnalyticsQuery(req.auth.orgId, req.body.query);
      } catch (err) {
        if (err instanceof AnalyticsQueryError) throw server.httpErrors.badRequest(err.message);
        throw err;
      }
      return {
        id: randomUUID(),
        reportId: '',
        status: 'done' as const,
        startedAt,
        finishedAt: new Date().toISOString(),
        rowCount: rows.length,
        result: rows,
        createdAt: startedAt,
      };
    },
  );

  // Synchronous run: persists the outcome (done|error) and returns the final
  // run row. Engine failures land on run.error, not HTTP 5xx.
  // reports:write gate: a persisted run mutates official run history that
  // dashboards surface via latestRunId — and the body can override the stored
  // query — so read-only members must use POST /reports/run (ephemeral).
  server.post(
    '/reports/:id/run',
    {
      preHandler: [server.requirePermission('reports:write')],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: IdParam,
        body: z.object({ query: AnalyticsQuery.optional() }).optional(),
        response: { 200: AnalyticsReportRun },
      },
    },
    async (req) => {
      const report = await prisma.analyticsReport.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, query: true },
      });
      if (!report) throw server.httpErrors.notFound('Report not found');
      // Stored queries were validated by the AnalyticsQuery schema on write.
      const query = req.body?.query ?? (report.query as unknown as AnalyticsQuery);
      const run = await runPersistedReport({
        orgId: req.auth.orgId,
        reportId: report.id,
        query,
        log: req.log,
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'analytics_report.run',
          targetType: 'analytics_report',
          targetId: report.id,
          diff: { runId: run.id, status: run.status },
        },
      });
      return serializeRun(run);
    },
  );

  server.get(
    '/reports/:id/runs',
    { preHandler: [server.requirePermission('reports:read')],  schema: { params: IdParam, response: { 200: z.array(AnalyticsReportRun) } } },
    async (req) => {
      const report = await prisma.analyticsReport.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!report) throw server.httpErrors.notFound('Report not found');
      // List ships metadata only — result blobs (up to 1MB each) are served
      // one at a time by GET /reports/:id/runs/:runId.
      const runs = await prisma.analyticsReportRun.findMany({
        where: { orgId: req.auth.orgId, reportId: report.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          reportId: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          rowCount: true,
          error: true,
          createdAt: true,
        },
      });
      return runs.map((r) => serializeRun({ ...r, result: null }));
    },
  );

  server.get(
    '/reports/:id/runs/:runId',
    { preHandler: [server.requirePermission('reports:read')], 
      schema: {
        params: z.object({ id: z.string().uuid(), runId: z.string().uuid() }),
        response: { 200: AnalyticsReportRun },
      },
    },
    async (req) => {
      // Soft-deleted reports must take their run history with them.
      const report = await prisma.analyticsReport.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!report) throw server.httpErrors.notFound('Report not found');
      const run = await prisma.analyticsReportRun.findFirst({
        where: { id: req.params.runId, reportId: report.id, orgId: req.auth.orgId },
      });
      if (!run) throw server.httpErrors.notFound('Run not found');
      return serializeRun(run);
    },
  );
};
