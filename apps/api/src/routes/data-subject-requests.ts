// GDPR data subject requests: export (Art. 15, 20) and erase (Art. 17) for one
// person, run as a worker job with a dry run by default.
//
// Admin gate: `settings:write` (Admin only in the RBAC matrix), same as the
// tenant export and the synchronous erasure route. Cross-tenant guard: :orgId
// must equal the caller's org; the subject is resolved org-scoped (404).
// The request row and its report hold ids and counts only. The export bundle
// is never stored: the download route rebuilds it from the live data and
// audits each download.

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  exportDataSubject,
  prisma,
  resolveDataSubject,
  serializeDataSubjectBundle,
  type DataSubjectRequest,
} from '@bidstack/db';
import {
  DataSubjectReport,
  DataSubjectRequestCreate,
  DataSubjectRequestIdParams,
  DataSubjectRequestParams,
  DataSubjectRequestView,
  type DataSubjectType,
} from '@bidstack/shared';

import { isApiKeyActor } from '../lib/access-scope.js';
import { enqueueDataSubjectRequest } from '../queues/data-subject.js';

/** API-key callers have no users row; their id cannot go into a uuid column. */
function humanActor(req: FastifyRequest): string | null {
  return isApiKeyActor(req.auth.userId) ? null : req.auth.userId;
}

function assertSameOrg(req: FastifyRequest, orgId: string): void {
  if (orgId !== req.auth.orgId) {
    throw req.server.httpErrors.forbidden('Cannot act on a data subject in another organization');
  }
}

function toView(row: DataSubjectRequest): DataSubjectRequestView {
  const report = DataSubjectReport.safeParse(row.report);
  return {
    id: row.id,
    kind: row.kind as DataSubjectRequestView['kind'],
    subjectType: row.subjectType as DataSubjectType,
    subjectId: row.subjectId,
    dryRun: row.dryRun,
    status: row.status as DataSubjectRequestView['status'],
    report: report.success ? report.data : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export const dataSubjectRequestRoutes: FastifyPluginAsyncZod = async (server) => {
  server.post(
    '/orgs/:orgId/data-subject-requests',
    {
      config: { permission: 'settings:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('settings:write'),
      schema: {
        params: DataSubjectRequestParams,
        body: DataSubjectRequestCreate,
        response: { 202: DataSubjectRequestView },
      },
    },
    async (req, reply) => {
      assertSameOrg(req, req.params.orgId);
      const orgId = req.auth.orgId;
      const { kind, subjectType, subjectId, dryRun } = req.body;
      const subject = await resolveDataSubject(prisma, orgId, subjectType, subjectId);
      if (!subject) throw req.server.httpErrors.notFound('Subject not found');

      const row = await prisma.dataSubjectRequest.create({
        data: { orgId, requestedById: humanActor(req), kind, subjectType, subjectId, dryRun },
      });
      await prisma.auditLog.create({
        data: {
          orgId,
          userId: humanActor(req),
          action: 'gdpr.dsr.requested',
          targetType: 'data_subject_request',
          targetId: row.id,
          diff: { kind, subjectType, subjectId, dryRun },
        },
      });
      await enqueueDataSubjectRequest({ requestId: row.id, orgId });
      return reply.code(202).send(toView(row));
    },
  );

  server.get(
    '/orgs/:orgId/data-subject-requests/:id',
    {
      config: { permission: 'settings:write' },
      preHandler: server.requirePermission('settings:write'),
      schema: { params: DataSubjectRequestIdParams, response: { 200: DataSubjectRequestView } },
    },
    async (req) => {
      assertSameOrg(req, req.params.orgId);
      const row = await prisma.dataSubjectRequest.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!row) throw req.server.httpErrors.notFound('Request not found');
      return toView(row);
    },
  );

  // Rebuilt from live data on each download so no export copy sits at rest.
  server.get(
    '/orgs/:orgId/data-subject-requests/:id/export',
    {
      config: { permission: 'settings:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('settings:write'),
      schema: { params: DataSubjectRequestIdParams },
    },
    async (req, reply) => {
      assertSameOrg(req, req.params.orgId);
      const orgId = req.auth.orgId;
      const row = await prisma.dataSubjectRequest.findFirst({
        where: { id: req.params.id, orgId },
      });
      if (!row || row.kind !== 'export') throw req.server.httpErrors.notFound('Export not found');
      if (row.status !== 'done' || row.dryRun) {
        throw req.server.httpErrors.conflict('Export is not ready (dry run or still running)');
      }
      const subject = await resolveDataSubject(
        prisma,
        orgId,
        row.subjectType as DataSubjectType,
        row.subjectId,
      );
      if (!subject) throw req.server.httpErrors.notFound('Subject not found');
      const bundle = await exportDataSubject(prisma, subject);
      await prisma.auditLog.create({
        data: {
          orgId,
          userId: humanActor(req),
          action: 'gdpr.export.downloaded',
          targetType: 'data_subject_request',
          targetId: row.id,
          diff: { stores: Object.keys(bundle.stores) },
        },
      });
      return reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('content-disposition', `attachment; filename="data-subject-${row.id}.json"`)
        .header('cache-control', 'no-store')
        .send(serializeDataSubjectBundle(bundle));
    },
  );
};
