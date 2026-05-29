// Bid workspace requirement + compliance matrix write routes.
//
// Endpoints:
//   POST  /api/v1/bid-workspaces/:opportunityId/requirements      — create requirement + matrix row
//   PATCH /api/v1/bid-workspaces/:opportunityId/matrix/:rowId     — patch a compliance matrix row
//
// Snapshot + document + compliance read routes → bid-workspace.ts
// Serializers and schemas → bid-workspace.helpers.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  ComplianceMatrixRow,
  ComplianceMatrixRowPatch,
  RequirementCreateRequest,
} from '@bidstack/shared';
import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';
import {
  WorkspaceParams,
  MatrixParams,
  RequirementCreateResult,
  ensureOpportunity,
  serializeRequirement,
  serializeMatrixRow,
  jsonArray,
} from './bid-workspace.helpers.js';

export const bidWorkspaceRequirementRoutes: FastifyPluginAsyncZod = async (server) => {
  // ─── POST /bid-workspaces/:opportunityId/requirements ─────────────────
  //
  // Creates a Requirement and its corresponding ComplianceMatrixRow atomically.
  // Validates ownership of ownerId, bidDocumentId, documentVersionId, and
  // sourceChunkId against the authenticated org before writing.

  server.post(
    '/bid-workspaces/:opportunityId/requirements',
    {
      preHandler: server.requirePermission('documents:write'),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: WorkspaceParams,
        body: RequirementCreateRequest,
        response: { 201: RequirementCreateResult },
      },
    },
    async (req, reply) => {
      const opportunity = await ensureOpportunity(req.auth.orgId, req.params.opportunityId);
      if (!opportunity) return reply.notFound('Opportunity not found');
      if (
        req.body.ownerId &&
        !(await tenantEntityBelongsToOrg('user', req.body.ownerId, req.auth.orgId))
      ) {
        return reply.notFound('Owner not found');
      }

      const document = await prisma.bidDocument.findFirst({
        where: {
          id: req.body.bidDocumentId,
          orgId: req.auth.orgId,
          opportunityId: opportunity.id,
          deletedAt: null,
        },
      });
      if (!document) return reply.notFound('Bid document not found');

      if (req.body.documentVersionId) {
        const versionCount = await prisma.documentVersion.count({
          where: {
            id: req.body.documentVersionId,
            orgId: req.auth.orgId,
            bidDocumentId: document.id,
            deletedAt: null,
          },
        });
        if (versionCount === 0) return reply.notFound('Document version not found');
      }
      if (req.body.sourceChunkId) {
        const chunkCount = await prisma.sourceChunk.count({
          where: {
            id: req.body.sourceChunkId,
            orgId: req.auth.orgId,
            bidDocumentId: document.id,
            documentVersionId: req.body.documentVersionId,
            deletedAt: null,
          },
        });
        if (chunkCount === 0) return reply.notFound('Source chunk not found');
      }

      const result = await prisma.$transaction(async (tx) => {
        const requirement = await tx.requirement.create({
          data: {
            orgId: req.auth.orgId,
            opportunityId: opportunity.id,
            bidDocumentId: document.id,
            documentVersionId: req.body.documentVersionId ?? null,
            sourceChunkId: req.body.sourceChunkId ?? null,
            externalRef: req.body.externalRef ?? null,
            text: req.body.text,
            requirementType: req.body.requirementType,
            mandatory: req.body.mandatory,
            priority: req.body.priority,
            confidenceBps: req.body.confidenceBps,
            ownerId: req.body.ownerId ?? null,
            dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
            metadata: req.body.metadata as Prisma.InputJsonValue,
          },
        });
        const matrixRow = await tx.complianceMatrixRow.create({
          data: {
            orgId: req.auth.orgId,
            opportunityId: opportunity.id,
            requirementId: requirement.id,
            ownerId: requirement.ownerId,
            risk: requirement.priority,
            dueDate: requirement.dueDate,
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'requirement.create',
            targetType: 'requirement',
            targetId: requirement.id,
            diff: { opportunityId: opportunity.id, bidDocumentId: document.id },
          },
        });
        return { requirement, matrixRow };
      });

      reply.status(201);
      return {
        requirement: serializeRequirement(result.requirement),
        matrixRow: serializeMatrixRow(result.matrixRow),
      };
    },
  );

  // ─── PATCH /bid-workspaces/:opportunityId/matrix/:rowId ───────────────
  //
  // Patches a compliance matrix row. Business rule: a row cannot be moved
  // to status 'approved' unless it has at least one source citation.
  // Sets approvedAt + approverUserId automatically when status === 'approved'.

  server.patch(
    '/bid-workspaces/:opportunityId/matrix/:rowId',
    {
      preHandler: server.requirePermission('documents:write'),
      schema: {
        params: MatrixParams,
        body: ComplianceMatrixRowPatch,
        response: { 200: ComplianceMatrixRow },
      },
    },
    async (req, reply) => {
      const opportunity = await ensureOpportunity(req.auth.orgId, req.params.opportunityId);
      if (!opportunity) return reply.notFound('Opportunity not found');
      if (
        req.body.ownerId &&
        !(await tenantEntityBelongsToOrg('user', req.body.ownerId, req.auth.orgId))
      ) {
        return reply.notFound('Owner not found');
      }

      const existing = await prisma.complianceMatrixRow.findFirst({
        where: {
          id: req.params.rowId,
          orgId: req.auth.orgId,
          opportunityId: opportunity.id,
          deletedAt: null,
        },
      });
      if (!existing) return reply.notFound('Compliance matrix row not found');

      const nextStatus = req.body.status ?? existing.status;
      const nextCitations = req.body.citations ?? jsonArray(existing.citations);
      // Citations required before a row can be marked approved — prevents rubber-stamping.
      if (nextStatus === 'approved' && nextCitations.length === 0) {
        throw server.httpErrors.conflict(
          'Cannot approve a compliance row without source citations',
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.complianceMatrixRow.update({
          where: { id: existing.id },
          data: {
            ...(req.body.ownerId !== undefined ? { ownerId: req.body.ownerId } : {}),
            ...(req.body.status !== undefined ? { status: req.body.status } : {}),
            ...(req.body.risk !== undefined ? { risk: req.body.risk } : {}),
            ...(req.body.responseStatus !== undefined
              ? { responseStatus: req.body.responseStatus }
              : {}),
            ...(req.body.answerDraft !== undefined ? { answerDraft: req.body.answerDraft } : {}),
            ...(req.body.evidence !== undefined
              ? { evidence: req.body.evidence as Prisma.InputJsonValue }
              : {}),
            ...(req.body.citations !== undefined
              ? { citations: req.body.citations as Prisma.InputJsonValue }
              : {}),
            ...(req.body.dueDate !== undefined
              ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null }
              : {}),
            ...(req.body.status === 'approved'
              ? { approvedAt: new Date(), approverUserId: req.auth.userId }
              : {}),
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'compliance_matrix.update',
            targetType: 'compliance_matrix_row',
            targetId: row.id,
            diff: req.body as Prisma.InputJsonValue,
          },
        });
        return row;
      });

      return serializeMatrixRow(updated);
    },
  );
};
