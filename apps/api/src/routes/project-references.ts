// Spotlight Ref receiving end (A5) — display + pre-sales validation of project
// references on an account. Ingestion is a documented stub until Spotlight Ref
// is reworked.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { ProjectReference, ProjectReferenceList } from '@bidstack/shared';

import { normalizeName } from '../services/crm/dashboard.utils.js';
import {
  ingestProjectReference,
  type IngestProjectReferenceInput,
} from '../services/project-reference.service.js';

const IdParam = z.object({ id: z.string().uuid() });

interface DbRow {
  id: string;
  accountKey: string;
  title: string;
  technicalSummary: string | null;
  businessSummary: string | null;
  status: string;
  sourceSystem: string;
  validatedById: string | null;
  dispatchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function serialize(row: DbRow): z.infer<typeof ProjectReference> {
  return {
    id: row.id,
    accountKey: row.accountKey,
    title: row.title,
    technicalSummary: row.technicalSummary,
    businessSummary: row.businessSummary,
    status: row.status as z.infer<typeof ProjectReference>['status'],
    sourceSystem: row.sourceSystem,
    validatedById: row.validatedById,
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Exported only so the type travels with the route module; the real ingestion
// trigger lands with the Spotlight Ref rework.
export type { IngestProjectReferenceInput };
export { ingestProjectReference };

export const projectReferencesRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/project-references',
    {
      schema: {
        querystring: z.object({ accountKey: z.string().min(1).max(255) }),
        response: { 200: ProjectReferenceList },
      },
    },
    async (req) => {
      const rows = await prisma.projectReference.findMany({
        where: {
          orgId: req.auth.orgId,
          accountKey: normalizeName(req.query.accountKey),
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items: rows.map(serialize) };
    },
  );

  // Pre-sales validation step: moves a manager-reviewed reference to validated.
  // TODO(Spotlight Ref): the create/ingestion endpoint lands with the reworked
  // Spotlight Ref architecture; the consultant -> manager authoring happens
  // upstream. Until then references arrive via ingestProjectReference() (seed +
  // tests) and pre-sales validates them here.
  server.patch(
    '/project-references/:id/validate',
    {
      preHandler: [server.requirePermission('accounts:write')],
      schema: { params: IdParam, response: { 200: ProjectReference } },
    },
    async (req) => {
      const existing = await prisma.projectReference.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!existing) throw server.httpErrors.notFound('Project reference not found');
      if (existing.status === 'dispatched') {
        throw server.httpErrors.conflict('Reference already dispatched');
      }
      await prisma.projectReference.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        data: { status: 'validated', validatedById: req.auth.userId },
      });
      const updated = await prisma.projectReference.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'project_reference.validate',
          targetType: 'project_reference',
          targetId: updated.id,
          diff: { status: 'validated' },
        },
      });
      return serialize(updated);
    },
  );
};
