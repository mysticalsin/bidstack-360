import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  BidDocument,
  BidDocumentRegisterRequest,
  BidWorkspaceSnapshot,
  ComplianceMatrixRow,
  ComplianceMatrixRowPatch,
  Requirement,
  RequirementCreateRequest,
} from '@bidstack/shared';
import type {
  ApprovalGate,
  ReviewIssue,
  SubmissionPackage,
} from '@bidstack/shared';

import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';
import { enqueueDocumentExtract } from '../queues/document-extract.js';

const WorkspaceParams = z.object({ opportunityId: z.string().uuid() });
const MatrixParams = z.object({
  opportunityId: z.string().uuid(),
  rowId: z.string().uuid(),
});

const RequirementCreateResult = z.object({
  requirement: Requirement,
  matrixRow: ComplianceMatrixRow,
});

function dateOnly(value: Date | null): string | null {
  return value?.toISOString().split('T')[0] ?? null;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function serializeBidDocument(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  companyId: string | null;
  accountId: string | null;
  title: string;
  documentType: string;
  status: string;
  source: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof BidDocument> {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    companyId: row.companyId,
    accountId: row.accountId,
    title: row.title,
    documentType: row.documentType as z.infer<typeof BidDocument>['documentType'],
    status: row.status as z.infer<typeof BidDocument>['status'],
    source: row.source,
    metadata: jsonRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeRequirement(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  bidDocumentId: string | null;
  documentVersionId: string | null;
  sourceChunkId: string | null;
  externalRef: string | null;
  text: string;
  requirementType: string;
  mandatory: boolean;
  priority: string;
  status: string;
  confidenceBps: number;
  ownerId: string | null;
  dueDate: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof Requirement> {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    bidDocumentId: row.bidDocumentId,
    documentVersionId: row.documentVersionId,
    sourceChunkId: row.sourceChunkId,
    externalRef: row.externalRef,
    text: row.text,
    requirementType: row.requirementType,
    mandatory: row.mandatory,
    priority: row.priority as z.infer<typeof Requirement>['priority'],
    status: row.status as z.infer<typeof Requirement>['status'],
    confidenceBps: row.confidenceBps,
    ownerId: row.ownerId,
    dueDate: dateOnly(row.dueDate),
    metadata: jsonRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeMatrixRow(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  requirementId: string;
  ownerId: string | null;
  status: string;
  risk: string;
  responseStatus: string;
  answerDraft: string | null;
  evidence: unknown;
  citations: unknown;
  dueDate: Date | null;
  approvedAt: Date | null;
  approverUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof ComplianceMatrixRow> {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    requirementId: row.requirementId,
    ownerId: row.ownerId,
    status: row.status as z.infer<typeof ComplianceMatrixRow>['status'],
    risk: row.risk as z.infer<typeof ComplianceMatrixRow>['risk'],
    responseStatus: row.responseStatus,
    answerDraft: row.answerDraft,
    evidence: jsonArray(row.evidence),
    citations: jsonArray(row.citations),
    dueDate: dateOnly(row.dueDate),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approverUserId: row.approverUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeReviewIssue(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  requirementId: string | null;
  sourceChunkId: string | null;
  category: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  recommendation: string | null;
  ownerId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ReviewIssue {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    requirementId: row.requirementId,
    sourceChunkId: row.sourceChunkId,
    category: row.category,
    severity: row.severity as z.infer<typeof ReviewIssue>['severity'],
    status: row.status as z.infer<typeof ReviewIssue>['status'],
    title: row.title,
    description: row.description,
    recommendation: row.recommendation,
    ownerId: row.ownerId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeApprovalGate(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  bidDocumentId: string | null;
  lockedVersionId: string | null;
  gateKey: string;
  status: string;
  approverUserId: string | null;
  decisionNotes: string | null;
  decidedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ApprovalGate {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    bidDocumentId: row.bidDocumentId,
    lockedVersionId: row.lockedVersionId,
    gateKey: row.gateKey,
    status: row.status as z.infer<typeof ApprovalGate>['status'],
    approverUserId: row.approverUserId,
    decisionNotes: row.decisionNotes,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    metadata: jsonRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeSubmissionPackage(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  name: string;
  status: string;
  contents: unknown;
  receipt: unknown;
  metadata: unknown;
  lockedAt: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SubmissionPackage {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    name: row.name,
    status: row.status as z.infer<typeof SubmissionPackage>['status'],
    contents: jsonArray(row.contents),
    receipt: row.receipt === null ? null : jsonRecord(row.receipt),
    metadata: jsonRecord(row.metadata),
    lockedAt: row.lockedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ensureOpportunity(orgId: string, opportunityId: string) {
  return prisma.opportunity.findFirst({
    where: { id: opportunityId, orgId, deletedAt: null },
    select: { id: true, companyId: true, customer: true },
  });
}

export const bidWorkspaceRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/bid-workspaces/:opportunityId',
    {
      preHandler: server.requirePermission('documents:read'),
      schema: {
        params: WorkspaceParams,
        response: { 200: BidWorkspaceSnapshot },
      },
    },
    async (req, reply) => {
      const opportunity = await ensureOpportunity(req.auth.orgId, req.params.opportunityId);
      if (!opportunity) return reply.notFound('Opportunity not found');

      const [documents, requirements, matrixRows, reviewIssues, approvalGates, submissionPackages] =
        await Promise.all([
          prisma.bidDocument.findMany({
            where: { orgId: req.auth.orgId, opportunityId: opportunity.id, deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 500,
          }),
          prisma.requirement.findMany({
            where: { orgId: req.auth.orgId, opportunityId: opportunity.id, deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 500,
          }),
          prisma.complianceMatrixRow.findMany({
            where: { orgId: req.auth.orgId, opportunityId: opportunity.id, deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 500,
          }),
          prisma.reviewIssue.findMany({
            where: { orgId: req.auth.orgId, opportunityId: opportunity.id, deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 500,
          }),
          prisma.approvalGate.findMany({
            where: { orgId: req.auth.orgId, opportunityId: opportunity.id, deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 500,
          }),
          prisma.submissionPackage.findMany({
            where: { orgId: req.auth.orgId, opportunityId: opportunity.id, deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 500,
          }),
        ]);

      return {
        opportunityId: opportunity.id,
        documents: documents.map(serializeBidDocument),
        requirements: requirements.map(serializeRequirement),
        matrixRows: matrixRows.map(serializeMatrixRow),
        reviewIssues: reviewIssues.map(serializeReviewIssue),
        approvalGates: approvalGates.map(serializeApprovalGate),
        submissionPackages: submissionPackages.map(serializeSubmissionPackage),
      };
    },
  );

  server.post(
    '/bid-workspaces/:opportunityId/documents',
    {
      preHandler: server.requirePermission('documents:write'),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: WorkspaceParams,
        body: BidDocumentRegisterRequest,
        response: { 201: BidDocument },
      },
    },
    async (req, reply) => {
      const opportunity = await ensureOpportunity(req.auth.orgId, req.params.opportunityId);
      if (!opportunity) return reply.notFound('Opportunity not found');

      const file = await prisma.fileAttachment.findFirst({
        where: { id: req.body.fileAttachmentId, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!file) return reply.notFound('File attachment not found');
      if (opportunity.companyId && file.companyId && opportunity.companyId !== file.companyId) {
        throw server.httpErrors.badRequest('File belongs to a different company than the opportunity');
      }

      const result = await prisma.$transaction(async (tx) => {
        const bidDocument = await tx.bidDocument.create({
          data: {
            orgId: req.auth.orgId,
            opportunityId: opportunity.id,
            companyId: file.companyId ?? opportunity.companyId,
            accountId: file.accountId,
            title: req.body.title,
            documentType: req.body.documentType,
            status: 'pending_extraction',
            source: req.body.source,
            metadata: req.body.metadata as Prisma.InputJsonValue,
          },
        });
        const version = await tx.documentVersion.create({
          data: {
            orgId: req.auth.orgId,
            bidDocumentId: bidDocument.id,
            versionNo: 1,
            fileAttachmentId: file.id,
            storageKey: file.storageKey,
            contentType: file.contentType,
            bytes: file.bytes,
            extractionStatus: 'queued',
            ocrStatus: 'queued',
          },
        });
        const extraction = await tx.documentExtraction.create({
          data: {
            orgId: req.auth.orgId,
            documentId: file.id,
            accountId: file.accountId ?? opportunity.customer,
            companyId: file.companyId ?? opportunity.companyId,
            status: 'pending',
            extractedData: {},
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'bid_document.register',
            targetType: 'bid_document',
            targetId: bidDocument.id,
            diff: {
              opportunityId: opportunity.id,
              fileAttachmentId: file.id,
              documentVersionId: version.id,
              extractionId: extraction.id,
            },
          },
        });
        return { bidDocument, version, extraction };
      });

      const jobId = await enqueueDocumentExtract({
        orgId: req.auth.orgId,
        accountId: result.extraction.accountId,
        documentId: file.id,
        extractionId: result.extraction.id,
        storageKey: file.storageKey,
        contentType: file.contentType,
        name: file.name,
        opportunityId: opportunity.id,
        bidDocumentId: result.bidDocument.id,
        documentVersionId: result.version.id,
      });
      if (!jobId) {
        await prisma.documentVersion.updateMany({
          where: { id: result.version.id, orgId: req.auth.orgId, bidDocumentId: result.bidDocument.id },
          data: { extractionStatus: 'pending' },
        });
      }

      reply.status(201);
      return serializeBidDocument(result.bidDocument);
    },
  );

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
      if (nextStatus === 'approved' && nextCitations.length === 0) {
        throw server.httpErrors.conflict('Cannot approve a compliance row without source citations');
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
