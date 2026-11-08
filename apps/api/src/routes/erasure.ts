// GDPR Article 17 (right to erasure), synchronous form.
//
// An org-admin erases a single data subject (a Contact or a Lead) by id. The
// work is done by the shared engine in @bidstack/db (eraseDataSubject): the
// subject row is tombstoned and soft-deleted, every sidecar store in
// personal-data-map.ts is scrubbed in the same transaction, and a
// `gdpr.erasure` audit row records field names and counts only. The queued
// form with a dry run is POST /orgs/:orgId/data-subject-requests.
//
// Admin gate: `settings:write` (Admin-only in the canonical RBAC matrix).
// Cross-tenant guard: :orgId MUST equal the caller's authenticated org. The
// subject is loaded org-scoped (404 if missing / wrong tenant).
//
// Idempotent: erasing an already-erased subject returns an empty
// scrubbedFields list, never an error.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { eraseDataSubject, prisma, resolveDataSubject } from '@bidstack/db';
import { ErasureOrgParams, ErasureRequest, ErasureSummary } from '@bidstack/shared';

import { isApiKeyActor } from '../lib/access-scope.js';

export const erasureRoutes: FastifyPluginAsyncZod = async (server) => {
  server.post(
    '/orgs/:orgId/erasure',
    {
      config: { permission: 'settings:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('settings:write'),
      schema: {
        params: ErasureOrgParams,
        body: ErasureRequest,
        response: { 200: ErasureSummary },
      },
    },
    async (req) => {
      if (req.params.orgId !== req.auth.orgId) {
        throw req.server.httpErrors.forbidden('Cannot erase a subject in another organization');
      }
      const { subjectType, subjectId } = req.body;
      const subject = await resolveDataSubject(prisma, req.auth.orgId, subjectType, subjectId);
      if (!subject) throw req.server.httpErrors.notFound('Subject not found');

      const report = await eraseDataSubject(prisma, subject, {
        dryRun: false,
        actorUserId: isApiKeyActor(req.auth.userId) ? null : req.auth.userId,
      });
      const primary = subjectType === 'contact' ? 'Contact' : 'Lead';
      const relatedScrubbed = Object.fromEntries(
        Object.entries(report.stores)
          .filter(([model]) => model !== primary)
          .map(([model, v]) => [model, v.rows + v.mentions]),
      );
      return {
        subjectType,
        subjectId,
        scrubbedFields: report.scrubbedFields,
        relatedScrubbed,
        erasedAt: new Date().toISOString(),
      };
    },
  );
};
