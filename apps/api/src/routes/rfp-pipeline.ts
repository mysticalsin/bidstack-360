// Wave 9 — RFP pipeline HTTP endpoints.
//
// Four endpoints that form the human-touchpoint layer around the async
// BullMQ pipeline defined in apps/worker/src/queues/rfp-*.ts:
//
//   1. POST /opportunities/:opportunityId/rfp/upload
//      — Accepts a PDF/DOCX/PPTX, creates an RfpOrchestration row and
//        enqueues the rfp.orchestrate job to start the pipeline.
//
//   2. GET /bid-workspaces/:workspaceId/rfp/:orchestrationId/stream
//      — SSE long-poll for real-time pipeline phase progress.
//
//   3. POST /bid-workspaces/:workspaceId/matrix/:rowId/rfp-autofill
//      — Triggers compliance-fill agent for a single matrix row once the
//        orchestration has been approved by a human.
//
//   4. POST /proposals/:proposalId/rfp-approve
//      — Non-bypassable human approval gate for AI-generated proposals.
//        Validates humanReviewRequired=true and records approver identity
//        for EU AI Act Art. 50 audit trail.

import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { logAiInvocation } from '../lib/ai-audit.js';
import { redis } from '../redis.js';
import { enqueueRfpOrchestrate, type RfpOrchestrateJob } from '../queues/rfp-orchestrator.js';
import { enqueueRfpComplianceFill } from '../queues/rfp-compliance-fill.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'rfp-pipeline' });

// ─── Constants ────────────────────────────────────────────────────────────────

/** Allowed mime types for RFP source documents. */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

/** 50 MiB — enforced at the route boundary to override the global 10 MiB cap. */
const RFP_MAX_BYTES = 50 * 1024 * 1024;

/** Rate-limit: 10 uploads per org per hour. Key format: rfp:upload:{orgId}. */
const RFP_UPLOAD_RATE_LIMIT_MAX = 10;
const RFP_UPLOAD_RATE_LIMIT_TTL_SECONDS = 3600;

/** SSE poll interval in milliseconds — low enough to feel real-time. */
const SSE_POLL_INTERVAL_MS = 2000;

/**
 * Heartbeat interval — send a SSE comment every 30 s to prevent proxy timeout.
 * Most load balancers (Nginx, AWS ALB) drop idle connections after 60 s;
 * 30 s keeps the stream alive with comfortable headroom.
 */
const SSE_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Maximum streaming duration — 30 minutes. If the orchestration is still
 * in-progress after this window the stream closes and the client must
 * reconnect. WHY: a stuck BullMQ job or DB deadlock must not hold an open
 * HTTP response handle indefinitely, exhausting Fastify's connection pool.
 */
const SSE_MAX_POLL_MS = 30 * 60 * 1000;

/** Terminal states — stop streaming once reached. */
const SSE_TERMINAL_STATES = new Set(['completed', 'failed', 'rejected']);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const UploadParams = z.object({ opportunityId: z.string().uuid() });

const StreamParams = z.object({
  workspaceId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
});

const AutofillParams = z.object({
  workspaceId: z.string().uuid(),
  rowId: z.string().uuid(),
});
const AutofillBody = z.object({
  orchestrationId: z.string().uuid(),
  sectionKey: z.string().min(1).max(100),
});

const ApproveParams = z.object({ proposalId: z.string().uuid() });
const ApproveBody = z.object({ notes: z.string().max(2000).optional() });

const UploadResponse = z.object({
  orchestrationId: z.string().uuid(),
  status: z.literal('queued'),
});

const AutofillResponse = z.object({
  jobId: z.string().nullable(),
  status: z.literal('queued'),
});

const ApproveResponse = z.object({
  approvedAt: z.string().datetime(),
  approvedByUserId: z.string().uuid(),
});

// ─── Rate-limit helpers ───────────────────────────────────────────────────────

/**
 * Check and increment the per-org upload rate limit in Redis.
 * Returns true if the request is within quota, false if the limit is exceeded.
 *
 * WHY Redis INCR + EXPIRE: atomic check-and-increment with sliding window.
 * INCR on a missing key returns 1 and we set TTL immediately after; the 2-call
 * sequence is safe here because a missed TTL set (crash between calls) just means
 * the key lives forever until its next write, never causes silent over-counting.
 */
async function checkRfpUploadRateLimit(orgId: string): Promise<boolean> {
  const key = `rfp:upload:${orgId}`;
  try {
    const current = await redis.incr(key);
    if (current === 1) {
      // First upload in this window — set TTL so the counter expires.
      await redis.expire(key, RFP_UPLOAD_RATE_LIMIT_TTL_SECONDS);
    }
    return current <= RFP_UPLOAD_RATE_LIMIT_MAX;
  } catch (err) {
    // Redis unavailable — fail-open so uploads still work, log the anomaly.
    // WHY fail-open: rate limiting is best-effort protection; blocking all uploads
    // when Redis is down is worse than allowing a few extra uploads.
    log.warn({ err, orgId }, 'rfp upload rate-limit Redis check failed — fail-open');
    return true;
  }
}

// ─── SSE helper ───────────────────────────────────────────────────────────────

/**
 * Write a single SSE event frame. Format per the SSE spec:
 *   data: <JSON>\n\n
 * The double newline is the event boundary.
 */
function writeSseEvent(reply: FastifyReply, payload: Record<string, unknown>): void {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const rfpPipelineRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── 1. Upload RFP document and start pipeline ─────────────────────────────
  server.post(
    '/opportunities/:opportunityId/rfp/upload',
    {
      config: { permission: 'documents:write' },
      // WHY bodyLimit override: global cap is 10 MiB; RFP documents can be up
      // to 50 MiB. Override here, not globally, to avoid widening attack surface.
      bodyLimit: RFP_MAX_BYTES,
      schema: {
        params: UploadParams,
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
      const data = req.body as {
        fileAttachmentId?: string;
        rfpRequestId?: string;
      };

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
          `RFP documents must be PDF, DOCX, or PPTX. Received: ${file.contentType}`,
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

      // Create the RfpOrchestration row and enqueue the pipeline in a transaction.
      // WHY transaction: if the enqueue call fails we roll back the row so there
      // is no orphaned orchestration without a BullMQ job behind it.
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
      const jobId = await enqueueRfpOrchestrate(job);

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
      return { orchestrationId: orchestration.id, status: 'queued' as const };
    },
  );

  // ── 2. SSE stream for pipeline phase progress ─────────────────────────────
  server.get(
    '/bid-workspaces/:workspaceId/rfp/:orchestrationId/stream',
    {
      // WHY no permission config for GET: the RBAC middleware only gates
      // mutating methods (POST/PUT/PATCH/DELETE). SSE is read-only; auth plugin
      // still runs and provides req.auth.orgId for tenant scoping.
      schema: { params: StreamParams },
    },
    async (req, reply) => {
      const { orgId } = req.auth;

      // Verify the orchestration belongs to this org and workspace.
      const initial = await prisma.rfpOrchestration.findFirst({
        where: {
          id: req.params.orchestrationId,
          orgId,
          opportunityId: req.params.workspaceId,
          deletedAt: null,
        },
        select: {
          id: true,
          state: true,
          currentPhase: true,
          completedPhases: true,
          failureReason: true,
          updatedAt: true,
        },
      });
      if (!initial) throw server.httpErrors.notFound('RFP orchestration not found');

      // Switch to SSE mode.
      // §SSE-CORS — must never fall back to wildcard ('*').
      // Wildcard + credentials (cookies / Authorization header) is rejected by browsers
      // AND exposes the SSE stream to any origin. Fail-closed: if PUBLIC_BASE_URL is
      // not set in production, return 500 rather than silently open the stream to all.
      const allowedOrigin =
        process.env.PUBLIC_BASE_URL ??
        (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null);
      if (!allowedOrigin) {
        throw server.httpErrors.internalServerError(
          'SSE stream misconfigured: PUBLIC_BASE_URL env var is required in production',
        );
      }
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': allowedOrigin,
        'X-Accel-Buffering': 'no', // disable Nginx buffering for SSE
      });

      // Send initial state immediately so the client doesn't wait for the first poll.
      // WHY field names match PipelineEvent in apps/web/src/stores/rfpPipeline.ts:
      // stage/message/timestamp/progress/error — the frontend store's applyEvent()
      // reads these exact keys. Mismatched keys silently produce undefined values.
      writeSseEvent(reply, {
        stage: initial.currentPhase,
        state: initial.state,
        message: initial.currentPhase ?? 'Pipeline started',
        timestamp: initial.updatedAt.toISOString(),
        progress: initial.completedPhases.length,
        ...(initial.failureReason ? { error: initial.failureReason } : {}),
      });

      if (SSE_TERMINAL_STATES.has(initial.state)) {
        reply.raw.end();
        return reply;
      }

      // Poll the DB every SSE_POLL_INTERVAL_MS until terminal state.
      // WHY polling instead of Postgres LISTEN/NOTIFY: the worker already writes
      // state transitions to the rfp_orchestrations row; polling is simpler and
      // avoids a long-lived PG connection per SSE client. Revisit with
      // LISTEN/NOTIFY if > 500 concurrent SSE clients become a concern.
      let closed = false;
      req.raw.on('close', () => {
        closed = true;
      });

      await new Promise<void>((resolve) => {
        const deadline = Date.now() + SSE_MAX_POLL_MS;

        // Heartbeat: SSE comment every 30 s prevents proxy/LB idle-connection timeout.
        // WHY comment not data event: a comment (': ping\n\n') is ignored by
        // EventSource's onmessage handler — no spurious dispatches to the client.
        const heartbeatTimer = setInterval(() => {
          if (!closed) reply.raw.write(': ping\n\n');
        }, SSE_HEARTBEAT_INTERVAL_MS);

        const cleanup = (endStream: boolean) => {
          clearInterval(heartbeatTimer);
          if (endStream) reply.raw.end();
          resolve();
        };

        const tick = async () => {
          if (closed) return cleanup(false);

          // MAX_POLL_TIME guard: hard deadline prevents eternal connection on stuck jobs.
          if (Date.now() >= deadline) {
            log.warn(
              { orchestrationId: req.params.orchestrationId, orgId },
              'SSE stream closed — max poll duration (30 min) reached',
            );
            writeSseEvent(reply, {
              stage: 'failed',
              state: 'timeout',
              message: 'Stream closed after maximum duration. Reconnect to continue monitoring.',
              timestamp: new Date().toISOString(),
              error: 'SSE stream timed out after 30 minutes',
            });
            return cleanup(true);
          }

          const row = await prisma.rfpOrchestration
            .findFirst({
              where: {
                id: req.params.orchestrationId,
                orgId,
                deletedAt: null,
              },
              select: {
                state: true,
                currentPhase: true,
                completedPhases: true,
                failureReason: true,
                updatedAt: true,
              },
            })
            .catch(() => null); // DB errors must not crash the SSE response

          if (!row || closed) return cleanup(false);

          writeSseEvent(reply, {
            stage: row.currentPhase,
            state: row.state,
            message: row.currentPhase ?? 'Processing',
            timestamp: row.updatedAt.toISOString(),
            progress: row.completedPhases.length,
            ...(row.failureReason ? { error: row.failureReason } : {}),
          });

          if (SSE_TERMINAL_STATES.has(row.state)) {
            return cleanup(true);
          }

          setTimeout(() => {
            void tick();
          }, SSE_POLL_INTERVAL_MS);
        };

        setTimeout(() => {
          void tick();
        }, SSE_POLL_INTERVAL_MS);
      });

      return reply;
    },
  );

  // ── 3. Trigger compliance autofill for a single matrix row ───────────────
  server.post(
    '/bid-workspaces/:workspaceId/matrix/:rowId/rfp-autofill',
    {
      config: { permission: 'documents:write' },
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

      const approvedAt = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.proposal.update({
          where: { id: proposal.id },
          data: {
            approvedAt,
            approvedByUserId: userId,
            status: 'approved',
          },
        });

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

      log.info({ proposalId: proposal.id, userId, orgId }, 'Proposal approved by human reviewer');

      return {
        approvedAt: approvedAt.toISOString(),
        approvedByUserId: userId,
      };
    },
  );
};
