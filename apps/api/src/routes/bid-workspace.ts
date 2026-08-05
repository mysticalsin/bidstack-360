// Bid workspace core routes.
//
// Endpoints:
//   GET  /api/v1/bid-workspaces/:opportunityId            — full workspace snapshot
//   GET  /api/v1/bid-workspaces/:opportunityId/compliance — compliance matrix with counts
//   POST /api/v1/bid-workspaces/:opportunityId/documents  — register a bid document
//
// Requirement + compliance matrix write routes → bid-workspace-requirements.ts
// Serializers and schemas → bid-workspace.helpers.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { BidDocument, BidDocumentRegisterRequest, BidWorkspaceSnapshot } from '@bidstack/shared';
import { enqueueDocumentExtract } from '../queues/document-extract.js';
import {
  WorkspaceParams,
  ensureOpportunity,
  serializeBidDocument,
  serializeRequirement,
  serializeMatrixRow,
  serializeReviewIssue,
  serializeApprovalGate,
  serializeSubmissionPackage,
} from './bid-workspace.helpers.js';

export const bidWorkspaceRoutes: FastifyPluginAsyncZod = async (server) => {
  // ─── GET /bid-workspaces/:opportunityId — full snapshot ────────────────

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

  // ─── GET /bid-workspaces/:opportunityId/compliance ─────────────────────
  //
  // Dedicated compliance matrix read endpoint consumed by useRfpCompliance().
  // Returns rows joined with their requirement text, plus aggregated counts for
  // the summary banner. Kept separate from the full BidWorkspaceSnapshot so the
  // compliance panel can refresh cheaply without re-fetching all documents.
  //
  // responseStatus mapping (AI worker writes 'YES'|'NO'|'PARTIAL'|'NOT_APPLICABLE'):
  //   'YES'         → compliant
  //   'NO'          → non_compliant
  //   'PARTIAL'     → partial
  //   other/default → pending
  //
  // aiConfidenceBps is the row's OWN assessment confidence (null until the
  // fill worker produces one) — not the requirement's extraction confidence.
  // assessmentStatus 'UNAVAILABLE' means the AI fallback ran; the UI renders
  // "not assessed", never 0% (fusion Phase 6: unknown ≠ bad).

  server.get(
    '/bid-workspaces/:opportunityId/compliance',
    {
      preHandler: server.requirePermission('documents:read'),
      schema: {
        params: WorkspaceParams,
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                requirement: z.string(),
                response: z.string().nullable(),
                status: z.enum(['pending', 'compliant', 'partial', 'non_compliant']),
                autoFilled: z.boolean(),
                aiConfidenceBps: z.number().int().min(0).max(10000).nullable(),
                assessmentStatus: z.enum(['ASSESSED', 'UNAVAILABLE', 'PENDING']),
                // Round 2 — the matrix's `section` and `mandatory` facets.
                // `section` is Requirement.requirementType: there is NO section
                // column in the schema (requirements table, schema.prisma:1640-
                // 1680), and requirementType is the only field that groups
                // requirements. Named `section` on the wire because that is what
                // the surface calls it; remap here the day a real one exists.
                section: z.string().nullable(),
                mandatory: z.boolean(),
              }),
            ),
            total: z.number().int(),
            compliantCount: z.number().int(),
            pendingCount: z.number().int(),
          }),
        },
      },
    },
    async (req, reply) => {
      const opportunity = await ensureOpportunity(req.auth.orgId, req.params.opportunityId);
      if (!opportunity) return reply.notFound('Opportunity not found');

      const matrixRows = await prisma.complianceMatrixRow.findMany({
        where: { orgId: req.auth.orgId, opportunityId: opportunity.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 500,
        select: {
          id: true,
          responseStatus: true,
          answerDraft: true,
          confidenceBps: true,
          assessmentStatus: true,
          requirement: { select: { text: true, requirementType: true, mandatory: true } },
        },
      });

      function toFrontendStatus(rs: string): 'pending' | 'compliant' | 'partial' | 'non_compliant' {
        if (rs === 'YES') return 'compliant';
        if (rs === 'NO') return 'non_compliant';
        if (rs === 'PARTIAL') return 'partial';
        return 'pending';
      }

      const items = matrixRows.map((row) => ({
        id: row.id,
        requirement: row.requirement.text,
        response: row.answerDraft,
        status: toFrontendStatus(row.responseStatus),
        // autoFilled = compliance-fill worker has assessed this row;
        // 'not_started' is the DB default before any AI processing.
        autoFilled: row.responseStatus !== 'not_started',
        aiConfidenceBps: row.confidenceBps,
        assessmentStatus: row.assessmentStatus,
        // 'general' is the column default, i.e. "not classified" — send null so
        // the facet does not offer a bucket that means nothing.
        section:
          row.requirement.requirementType && row.requirement.requirementType !== 'general'
            ? row.requirement.requirementType
            : null,
        mandatory: row.requirement.mandatory,
      }));

      return {
        items,
        total: items.length,
        compliantCount: items.filter((i) => i.status === 'compliant').length,
        pendingCount: items.filter((i) => i.status === 'pending').length,
      };
    },
  );

  // ─── POST /bid-workspaces/:opportunityId/documents ─────────────────────

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
        throw server.httpErrors.badRequest(
          'File belongs to a different company than the opportunity',
        );
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
          where: {
            id: result.version.id,
            orgId: req.auth.orgId,
            bidDocumentId: result.bidDocument.id,
          },
          data: { extractionStatus: 'pending' },
        });
      }

      reply.status(201);
      return serializeBidDocument(result.bidDocument);
    },
  );
};
