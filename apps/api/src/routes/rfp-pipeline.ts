// Wave 9 — RFP pipeline HTTP endpoints.
//
// Three authenticated routes + SSE stream (registered as sub-plugin):
//
//   1. POST /opportunities/:opportunityId/rfp/upload
//      — Accepts supported RFP document/text/image formats, creates an RfpOrchestration row and
//        enqueues the rfp.orchestrate job to start the pipeline.
//
//   2. GET /bid-workspaces/:workspaceId/rfp/:orchestrationId/stream
//      — SSE long-poll for real-time pipeline phase progress (→ rfp-pipeline-stream.ts).
//
//   3. POST /bid-workspaces/:workspaceId/matrix/:rowId/rfp-autofill
//      — Triggers compliance-fill agent for a single matrix row once the
//        orchestration has been approved by a human.
//
//   4. POST /proposals/:proposalId/rfp-approve
//      — Non-bypassable human approval gate for AI-generated proposals.
//        Validates humanReviewRequired=true and records approver identity
//        for EU AI Act Art. 50 audit trail.
//
// Constants + schemas + helpers → rfp-pipeline.helpers.ts
// SSE stream route              → rfp-pipeline-stream.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { logAiInvocation } from '../lib/ai-audit.js';
import { enqueueRfpOrchestrate, type RfpOrchestrateJob } from '../queues/rfp-orchestrator.js';
import { enqueueRfpComplianceFill } from '../queues/rfp-compliance-fill.js';
import { enqueueRfpSectionDraft } from '../queues/rfp-section-draft.js';
import { createLogger } from '../lib/logger.js';
import {
  ALLOWED_MIME_TYPES,
  RFP_MAX_BYTES,
  RFP_UPLOAD_RATE_LIMIT_MAX,
  UploadParams,
  AutofillParams,
  AutofillBody,
  ApproveParams,
  ApproveBody,
  UploadResponse,
  AutofillResponse,
  ApproveResponse,
  ResumeDraftingParams,
  ResumeDraftingResponse,
  checkRfpUploadRateLimit,
} from './rfp-pipeline.helpers.js';
import { rfpPipelineStreamRoutes } from './rfp-pipeline-stream.js';

const log = createLogger({ name: 'rfp-pipeline' });

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const rfpPipelineRoutes: FastifyPluginAsyncZod = async (server) => {
  // SSE stream route registered as a sub-plugin so it shares the same prefix.
  await server.register(rfpPipelineStreamRoutes);

  // ── 1. Upload RFP document and start pipeline ─────────────────────────────
  server.post(
    '/opportunities/:opportunityId/rfp/upload',
    {
      config: { permission: 'documents:write' },
      // config.permission is observability-only — enforce the gate with a real
      // preHandler so a read-only org member can't start AI/Dust spend.
      preHandler: server.requirePermission('documents:write'),
      // WHY bodyLimit override: global cap is 10 MiB; RFP documents can be up
      // to 50 MiB. Override here, not globally, to avoid widening attack surface.
      bodyLimit: RFP_MAX_BYTES,
      schema: {
        params: UploadParams,
        body: z.object({
          fileAttachmentId: z.string().uuid(),
          rfpRequestId: z.string().uuid().optional(),
        }),
        response: { 202: UploadResponse },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;

      // Verify opportunity belongs to this org before accepting the upload.
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: req.params.opportunityId, orgId, deletedAt: null },
        select: { id: true },
      });
      if (!opportunity) throw server.httpErrors.notFound('Opportunity not found');

      // Per-org upload rate limit.
      const withinLimit = await checkRfpUploadRateLimit(orgId);
      if (!withinLimit) {
        throw server.httpErrors.tooManyRequests(
          `RFP upload limit: ${RFP_UPLOAD_RATE_LIMIT_MAX} uploads per hour per organisation`,
        );
      }

      // Parse multipart. Fastify's content-type parser handles multipart when
      // @fastify/multipart is registered, but we use the pre-signed URL pattern
      // consistent with files.ts: the client sends metadata here, uploads bytes
      // directly to storage, and we reference the finalized FileAttachment.
      //
      // WHY not stream the file here: avoids streaming 50 MiB through the API
      // process — same rationale as files.ts §1 comment.
      const data = req.body;

      // fileAttachmentId is required — caller must finalize storage first.
      if (typeof data?.fileAttachmentId !== 'string') {
        throw server.httpErrors.badRequest(
          'fileAttachmentId is required — finalize the upload via POST /api/v1/files/finalize first',
        );
      }

      const file = await prisma.fileAttachment.findFirst({
        where: { id: data.fileAttachmentId, orgId, deletedAt: null },
        select: { id: true, contentType: true, bytes: true, storageKey: true, name: true },
      });
      if (!file) throw server.httpErrors.notFound('File attachment not found');

      // Validate mime type against allowed set.
      if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.contentType)) {
        throw server.httpErrors.unsupportedMediaType(
          `RFP upload format is not supported. Received: ${file.contentType}`,
        );
      }
      if (file.bytes > RFP_MAX_BYTES) {
        // WHY payloadTooLarge: @fastify/sensible maps HTTP 413 to payloadTooLarge.
        throw server.httpErrors.payloadTooLarge(
          `RFP document exceeds the 50 MiB limit (${file.bytes} bytes)`,
        );
      }

      // Resolve rfpRequestId: caller may provide one, or we derive from the opp.
      const rfpRequestId =
        typeof data.rfpRequestId === 'string' ? data.rfpRequestId : req.params.opportunityId; // use opportunityId as synthetic rfpRequestId if absent

      // WHY two-step: DocumentVersion requires a BidDocument parent (non-nullable FK).
      // Create the BidDocument first, then version — consistent with bid-workspace.ts pattern.
      const bidDocument = await prisma.bidDocument.create({
        data: {
          orgId,
          opportunityId: opportunity.id,
          title: file.name,
          documentType: 'rfp',
          status: 'intake',
          source: 'upload',
        },
        select: { id: true },
      });

      const docVersion = await prisma.documentVersion.create({
        data: {
          orgId,
          bidDocumentId: bidDocument.id,
          versionNo: 1,
          fileAttachmentId: file.id,
          storageKey: file.storageKey,
          contentType: file.contentType,
          bytes: file.bytes,
          extractionStatus: 'queued',
          ocrStatus: 'queued',
        },
        select: { id: true },
      });

      // Create the RfpOrchestration row, then enqueue the pipeline. If the
      // enqueue fails we delete the row below, so there is never an orphaned
      // orchestration without a BullMQ job behind it. Not a DB transaction: the
      // enqueue is a Redis op outside Postgres, so the rollback is an explicit
      // delete in the catch.
      const orchestration = await prisma.rfpOrchestration.create({
        data: {
          orgId,
          rfpRequestId,
          opportunityId: opportunity.id,
          documentVersionId: docVersion.id,
          state: 'queued',
          startedByUserId: userId,
        },
        select: { id: true, state: true },
      });

      const job: RfpOrchestrateJob = {
        orgId,
        rfpRequestId,
        documentVersionId: docVersion.id,
        opportunityId: opportunity.id,
        startedByUserId: userId,
      };
      // enqueueRfpOrchestrate returns null only for the intentional test-mode
      // skip; on a genuine failure it throws. Roll back the orchestration on
      // failure so the client gets a 503 (retryable) rather than a 202 over a
      // dead row.
      let jobId: string | null;
      try {
        jobId = await enqueueRfpOrchestrate(job);
      } catch (err) {
        await prisma.rfpOrchestration
          .delete({ where: { id: orchestration.id } })
          .catch(() => undefined);
        log.error(
          { err, orchestrationId: orchestration.id, orgId, opportunityId: opportunity.id },
          'RFP enqueue failed — rolled back orchestration',
        );
        throw server.httpErrors.serviceUnavailable(
          'RFP pipeline could not be started (queue unavailable). Please retry.',
        );
      }

      if (jobId) {
        // Persist the BullMQ root job ID for progress correlation.
        await prisma.rfpOrchestration.update({
          where: { id: orchestration.id },
          data: { rootJobId: jobId },
        });
      }

      await prisma.auditLog.create({
        data: {
          orgId,
          userId,
          action: 'rfp_orchestration.start',
          targetType: 'rfp_orchestration',
          targetId: orchestration.id,
          diff: {
            opportunityId: opportunity.id,
            fileAttachmentId: file.id,
            bidDocumentId: bidDocument.id,
            documentVersionId: docVersion.id,
            rfpRequestId,
          },
        },
      });

      log.info(
        { orchestrationId: orchestration.id, jobId, orgId, opportunityId: opportunity.id },
        'RFP pipeline started',
      );

      reply.status(202);
      // bidWorkspaceId === opportunityId in this domain model; the web client
      // needs it to open the RFP progress SSE stream.
      return {
        orchestrationId: orchestration.id,
        bidWorkspaceId: opportunity.id,
        status: 'queued' as const,
      };
    },
  );

  // ── 3. Trigger compliance autofill for a single matrix row ───────────────
  server.post(
    '/bid-workspaces/:workspaceId/matrix/:rowId/rfp-autofill',
    {
      config: { permission: 'documents:write' },
      // Enforce the gate (config.permission is observability-only): autofill
      // writes AI content to compliance rows, so require documents:write.
      preHandler: server.requirePermission('documents:write'),
      schema: {
        params: AutofillParams,
        body: AutofillBody,
        response: { 202: AutofillResponse },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;

      // Verify the orchestration belongs to this org.
      const orchestration = await prisma.rfpOrchestration.findFirst({
        where: {
          id: req.body.orchestrationId,
          orgId,
          deletedAt: null,
        },
        select: { id: true, state: true },
      });
      if (!orchestration) throw server.httpErrors.notFound('RFP orchestration not found');

      // WHY guard on 'approved': autofill writes AI output to the compliance
      // matrix. A human must have approved the pipeline (state=approved) before
      // AI-generated content can populate production-visible rows.
      if (orchestration.state !== 'approved') {
        throw server.httpErrors.conflict(
          `RFP orchestration must be in 'approved' state before autofill. Current state: '${orchestration.state}'`,
        );
      }

      // Verify the matrix row belongs to this org and workspace.
      const matrixRow = await prisma.complianceMatrixRow.findFirst({
        where: {
          id: req.params.rowId,
          orgId,
          opportunityId: req.params.workspaceId,
          deletedAt: null,
        },
        select: { id: true, requirementId: true },
      });
      if (!matrixRow) throw server.httpErrors.notFound('Compliance matrix row not found');

      // Fetch requirement text for the job payload.
      const requirement = await prisma.requirement.findFirst({
        where: { id: matrixRow.requirementId, orgId, deletedAt: null },
        select: { text: true },
      });

      const jobId = await enqueueRfpComplianceFill({
        orgId,
        orchestrationId: orchestration.id,
        matrixItemId: matrixRow.id,
        requirementText: requirement?.text ?? '',
        category: req.body.sectionKey,
      });

      reply.status(202);
      return { jobId, status: 'queued' as const };
    },
  );

  // ── 4. Human approval gate for AI-generated proposal ─────────────────────
  server.post(
    '/proposals/:proposalId/rfp-approve',
    {
      config: { permission: 'proposals:write' },
      preHandler: server.requirePermission('proposals:write'),
      schema: {
        params: ApproveParams,
        body: ApproveBody,
        response: { 200: ApproveResponse },
      },
    },
    async (req, _reply) => {
      const { orgId, userId } = req.auth;

      const proposal = await prisma.proposal.findFirst({
        where: { id: req.params.proposalId, orgId, deletedAt: null },
        select: {
          id: true,
          humanReviewRequired: true,
          approvedAt: true,
          name: true,
          opportunityId: true,
        },
      });
      if (!proposal) throw server.httpErrors.notFound('Proposal not found');

      // WHY explicit 409 instead of silent pass-through: a proposal that does
      // not require human review should never reach this endpoint in normal
      // flow. Returning 409 surfaces misconfigured orchestration quickly.
      if (!proposal.humanReviewRequired) {
        throw server.httpErrors.conflict(
          'This proposal does not require human approval (humanReviewRequired=false)',
        );
      }

      if (proposal.approvedAt !== null) {
        throw server.httpErrors.conflict('Proposal has already been approved');
      }

      // ── RFP-GATE-001 — approval must gate the linked orchestration ──────────
      // WHY: this endpoint is the EU AI Act Art. 50 human-in-the-loop gate for
      // the whole RFP pipeline. Approving the proposal row alone used to leave
      // the orchestration stranded in 'awaiting_approval' — so downstream
      // compliance autofill (which requires state='approved') was unreachable —
      // and let a bid be approved while high/critical review issues were open.
      const orchestration = await prisma.rfpOrchestration.findFirst({
        where: { proposalId: proposal.id, orgId, deletedAt: null },
        select: { id: true, state: true, opportunityId: true, completedPhases: true },
      });
      if (!orchestration) {
        // No pipeline run is linked to this proposal — the RFP gate does not
        // apply. Fail loud rather than silently approving an unmanaged proposal.
        throw server.httpErrors.conflict(
          'No RFP orchestration is linked to this proposal; it cannot be approved through the RFP gate',
        );
      }
      // The pipeline reaches this gate only after qa_review (see
      // markOrchestrationAwaitingApproval). Requiring state='awaiting_approval'
      // AND qa_review completed distinguishes the final proposal gate from the
      // earlier drafting gate and blocks premature / double approval.
      const atFinalGate =
        orchestration.state === 'awaiting_approval' &&
        orchestration.completedPhases.includes('qa_review');
      if (!atFinalGate) {
        throw server.httpErrors.conflict(
          `RFP orchestration is not awaiting final approval (state: '${orchestration.state}')`,
        );
      }

      // Block approval while any high/critical review issue for THIS proposal's
      // run is unresolved. Scoped by proposalId (not the opportunity) so a
      // sibling re-run's findings never bleed in and a re-scan cannot retire
      // another run's blockers (RFP-REVIEW-001). Resolved and waived issues do
      // not block — a waiver is an explicit, audited human decision.
      const blockerWhere: Prisma.ReviewIssueWhereInput = {
        orgId,
        proposalId: proposal.id,
        severity: { in: ['high', 'critical'] },
        status: { in: ['open', 'acknowledged', 'in_progress'] },
        deletedAt: null,
      };

      // Fast-fail before opening the transaction (the common case).
      const preBlockers = await prisma.reviewIssue.count({ where: blockerWhere });
      if (preBlockers > 0) {
        throw server.httpErrors.conflict(
          `Cannot approve: ${preBlockers} unresolved high/critical review ` +
            `${preBlockers === 1 ? 'issue' : 'issues'} must be resolved or waived first`,
        );
      }

      const approvedAt = new Date();

      await prisma.$transaction(async (tx) => {
        // Atomic approval guard: updateMany with approvedAt IS NULL means a
        // concurrent double-approval loses the race (the second write sees
        // count 0) without a separate row lock.
        const approved = await tx.proposal.updateMany({
          where: { id: proposal.id, orgId, approvedAt: null },
          data: {
            approvedAt,
            approvedByUserId: userId,
            status: 'approved',
          },
        });
        if (approved.count !== 1) {
          throw server.httpErrors.conflict('Proposal has already been approved');
        }

        // Advance the orchestration to 'approved' so compliance autofill (which
        // requires state='approved') becomes reachable. Conditional on the
        // current state so a concurrent transition is not clobbered; assert
        // exactly one row moved or roll the whole approval back.
        const moved = await tx.$executeRaw`
          UPDATE rfp_orchestrations
          SET state = 'approved', updated_at = now()
          WHERE id = ${orchestration.id}::uuid
            AND org_id = ${orgId}::uuid
            AND state = 'awaiting_approval'
        `;
        if (moved !== 1) {
          throw server.httpErrors.conflict(
            'RFP orchestration changed state during approval; please retry',
          );
        }

        // TOCTOU guard: re-check blockers INSIDE the transaction. A worker that
        // inserts a high/critical finding for this run between the fast-fail and
        // here is caught, rolling the whole approval back.
        const liveBlockers = await tx.reviewIssue.count({ where: blockerWhere });
        if (liveBlockers > 0) {
          throw server.httpErrors.conflict(
            `Cannot approve: ${liveBlockers} unresolved high/critical review ` +
              `${liveBlockers === 1 ? 'issue' : 'issues'} must be resolved or waived first`,
          );
        }

        await tx.auditLog.create({
          data: {
            orgId,
            userId,
            action: 'proposal.rfp_approve',
            targetType: 'proposal',
            targetId: proposal.id,
            diff: {
              approvedAt: approvedAt.toISOString(),
              approvedByUserId: userId,
              orchestrationId: orchestration.id,
              orchestrationState: 'approved',
              blockersChecked: liveBlockers,
              notes: req.body.notes ?? null,
            },
          },
        });
      });

      // EU AI Act Art. 50 — log human-in-the-loop decision.
      // WHY fire-and-forget: audit failure must never block the approval;
      // the auditLog row above is the primary paper trail.
      void logAiInvocation({
        orgId,
        userId,
        agentType: 'human-approval',
        model: 'human',
        prompt: `Proposal approval: ${proposal.name}`,
        response: req.body.notes ?? 'approved',
        tokenCount: 0,
        durationMs: 0,
        status: 'success',
      });

      log.info(
        { proposalId: proposal.id, orchestrationId: orchestration.id, userId, orgId },
        'Proposal approved by human reviewer; orchestration advanced to approved',
      );

      return {
        approvedAt: approvedAt.toISOString(),
        approvedByUserId: userId,
        orchestrationId: orchestration.id,
        orchestrationState: 'approved' as const,
      };
    },
  );

  // ── 5. Human approval gate to resume AI section drafting ──────────────────
  server.post(
    '/bid-workspaces/:workspaceId/rfp/:orchestrationId/approve-drafting',
    {
      config: { permission: 'proposals:write' },
      preHandler: server.requirePermission('proposals:write'),
      schema: {
        params: ResumeDraftingParams,
        response: { 200: ResumeDraftingResponse },
      },
    },
    async (req, _reply) => {
      const { orgId, userId } = req.auth;
      const { orchestrationId } = req.params;

      const orchestration = await prisma.rfpOrchestration.findFirst({
        where: { id: orchestrationId, orgId, deletedAt: null },
        select: { id: true, state: true, proposalId: true, documentVersionId: true },
      });
      if (!orchestration) throw server.httpErrors.notFound('RFP orchestration not found');

      if (orchestration.state !== 'awaiting_approval') {
        throw server.httpErrors.conflict(
          `Pipeline is not awaiting drafting approval. Current state: '${orchestration.state}'`,
        );
      }

      if (!orchestration.proposalId) {
        throw server.httpErrors.conflict('Pipeline is missing a proposal to draft.');
      }

      const sections = await prisma.proposalSection.findMany({
        where: { proposalId: orchestration.proposalId, orgId, deletedAt: null },
        select: { id: true, title: true },
      });

      const requirements = orchestration.documentVersionId
        ? await prisma.requirement.findMany({
            where: { documentVersionId: orchestration.documentVersionId, orgId, deletedAt: null },
            select: { id: true },
          })
        : [];
      const requirementIds = requirements.map((req) => req.id);

      // Resume pipeline state to 'running'
      await prisma.$executeRaw`
        UPDATE rfp_orchestrations
        SET state = 'running',
            updated_at = now()
        WHERE id = ${orchestration.id}::uuid AND org_id = ${orgId}::uuid
      `;

      let jobsDispatched = 0;
      for (const section of sections) {
        const jobId = await enqueueRfpSectionDraft({
          orgId,
          orchestrationId: orchestration.id,
          proposalId: orchestration.proposalId,
          sectionId: section.id,
          sectionTitle: section.title,
          requirementIds,
        });
        if (jobId) jobsDispatched++;
      }

      await prisma.auditLog.create({
        data: {
          orgId,
          userId,
          action: 'rfp_orchestration.approve_drafting',
          targetType: 'rfp_orchestration',
          targetId: orchestration.id,
          diff: { approvedByUserId: userId, jobsDispatched },
        },
      });

      log.info(
        { orchestrationId: orchestration.id, userId, orgId, jobsDispatched },
        'Drafting phase resumed by human reviewer',
      );

      return { status: 'running' as const, jobsDispatched };
    },
  );
};
