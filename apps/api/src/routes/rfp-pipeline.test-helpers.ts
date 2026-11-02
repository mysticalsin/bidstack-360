/**
 * rfp-pipeline.test-helpers.ts
 *
 * Shared test context factory for the RFP pipeline integration test suite.
 * Each describe-level test file calls makeRfpTestContext() at module top level.
 * The factory registers beforeAll/afterAll for that file's root suite and returns
 * a mutable ctx object plus all shared helper closures.
 *
 * Extracted from rfp-pipeline.integration.test.ts (BS-R1 file-size refactor).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import { redis } from '../redis.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type Cleanup = {
  opportunities: string[];
  files: string[];
  bidDocuments: string[];
  documentVersions: string[];
  rfpOrchestrations: string[];
  complianceMatrixRows: string[];
  requirements: string[];
  reviewIssues: string[];
  proposals: string[];
  /** AuditLog PK is BigInt (autoincrement). */
  auditLogs: bigint[];
};

export type RfpTestCtx = {
  server: FastifyInstance;
  orgId: string | null;
  userId: string | null;
  dbReachable: boolean;
  rfpTablesReady: boolean;
  cleanup: Cleanup;
};

// ─── Factory ─────────────────────────────────────────────────────────────────

export function makeRfpTestContext() {
  const ctx: RfpTestCtx = {
    server: null as unknown as FastifyInstance,
    orgId: null,
    userId: null,
    dbReachable: false,
    rfpTablesReady: false,
    cleanup: {
      opportunities: [],
      files: [],
      bidDocuments: [],
      documentVersions: [],
      rfpOrchestrations: [],
      complianceMatrixRows: [],
      requirements: [],
      reviewIssues: [],
      proposals: [],
      auditLogs: [],
    },
  };
  let restoreAuth: (() => void) | null = null;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      ctx.dbReachable = true;
    } catch {
      ctx.dbReachable = false;
      return;
    }

    try {
      const check = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT to_regclass('public.rfp_orchestrations') IS NOT NULL AS "exists"
      `;
      ctx.rfpTablesReady = check[0]?.exists ?? false;
    } catch {
      ctx.rfpTablesReady = false;
    }
    if (!ctx.rfpTablesReady) return;

    const iso = await createIsolatedOrg('rfp-pipeline');
    ctx.orgId = iso.orgId;
    restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);

    // WHY: the per-org upload rate-limit key persists in Redis across test runs
    // (TTL = 1 hour). Without a flush here the counter accumulates and eventually
    // causes 429 responses where the tests expect 415, 202, etc.
    try {
      await redis.del(`rfp:upload:${ctx.orgId}`);
    } catch {
      // Redis unavailable — fail-open; rate-limit tests still exercise the mock path.
    }

    // Pick the first seed user for assertions against approvedByUserId.
    const user = await prisma.user.findFirst({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    ctx.userId = user?.id ?? null;

    ctx.server = await buildServer();
    await ctx.server.ready();
  }, 30_000);

  afterAll(async () => {
    if (ctx.dbReachable && ctx.rfpTablesReady) {
      // Delete in FK-dependency order (children before parents).
      if (ctx.cleanup.auditLogs.length > 0) {
        await prisma.auditLog.deleteMany({ where: { id: { in: ctx.cleanup.auditLogs } } });
      }
      if (ctx.cleanup.rfpOrchestrations.length > 0) {
        await prisma.rfpOrchestration.deleteMany({
          where: { id: { in: ctx.cleanup.rfpOrchestrations } },
        });
      }
      if (ctx.cleanup.complianceMatrixRows.length > 0) {
        await prisma.complianceMatrixRow.deleteMany({
          where: { id: { in: ctx.cleanup.complianceMatrixRows } },
        });
      }
      // ReviewIssue references opportunity + requirement — delete before both.
      if (ctx.cleanup.reviewIssues.length > 0) {
        await prisma.reviewIssue.deleteMany({
          where: { id: { in: ctx.cleanup.reviewIssues } },
        });
      }
      if (ctx.cleanup.requirements.length > 0) {
        await prisma.requirement.deleteMany({
          where: { id: { in: ctx.cleanup.requirements } },
        });
      }
      if (ctx.cleanup.documentVersions.length > 0) {
        await prisma.documentVersion.deleteMany({
          where: { id: { in: ctx.cleanup.documentVersions } },
        });
      }
      if (ctx.cleanup.bidDocuments.length > 0) {
        await prisma.bidDocument.deleteMany({
          where: { id: { in: ctx.cleanup.bidDocuments } },
        });
      }
      if (ctx.cleanup.proposals.length > 0) {
        await prisma.proposal.deleteMany({ where: { id: { in: ctx.cleanup.proposals } } });
      }
      if (ctx.cleanup.files.length > 0) {
        await prisma.fileAttachment.deleteMany({ where: { id: { in: ctx.cleanup.files } } });
      }
      if (ctx.cleanup.opportunities.length > 0) {
        await prisma.opportunity.deleteMany({
          where: { id: { in: ctx.cleanup.opportunities } },
        });
      }
    }
    if (ctx.server) await ctx.server.close();
    restoreAuth?.();
    if (ctx.dbReachable && ctx.orgId) await dropIsolatedOrg(ctx.orgId);
    if (ctx.dbReachable) await prisma.$disconnect();
  });

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Convenience wrapper: throw the canonical skip message when pre-conditions are
   * not met, rather than letting tests silently pass or fail with cryptic errors.
   */
  const skipIfNoDb = makeSkipIfNoDb(() => ctx.dbReachable && ctx.rfpTablesReady && !!ctx.orgId);

  /** Create a minimal opportunity owned by the isolated org. */
  async function createOpportunity(label = 'rfp-test') {
    const opp = await prisma.opportunity.create({
      data: {
        orgId: ctx.orgId!,
        code: `RFP-${label.toUpperCase().slice(0, 4)}-${randomUUID().slice(0, 8)}`,
        customer: label,
        name: `RFP Integration Test — ${label}`,
        stage: 's1_lead',
      },
    });
    ctx.cleanup.opportunities.push(opp.id);
    return opp;
  }

  /** Create a FileAttachment owned by the isolated org. */
  async function createFile(opts: { contentType?: string; bytes?: number } = {}) {
    const file = await prisma.fileAttachment.create({
      data: {
        orgId: ctx.orgId!,
        accountId: 'rfp-integration-test',
        name: 'test-rfp.pdf',
        contentType: opts.contentType ?? 'application/pdf',
        bytes: opts.bytes ?? 1024,
        storageKey: `${ctx.orgId}/rfp-integration/${randomUUID()}/test-rfp.pdf`,
      },
    });
    ctx.cleanup.files.push(file.id);
    return file;
  }

  /**
   * Create a complete upload fixture: opportunity + file + bid-document +
   * document-version + rfp-orchestration in a given state.
   */
  async function createOrchestrationFixture(state = 'running') {
    const opp = await createOpportunity('orch-fixture');
    const file = await createFile();

    const bidDoc = await prisma.bidDocument.create({
      data: {
        orgId: ctx.orgId!,
        opportunityId: opp.id,
        title: file.name,
        documentType: 'rfp',
        status: 'intake',
        source: 'upload',
      },
    });
    ctx.cleanup.bidDocuments.push(bidDoc.id);

    const docVersion = await prisma.documentVersion.create({
      data: {
        orgId: ctx.orgId!,
        bidDocumentId: bidDoc.id,
        versionNo: 1,
        fileAttachmentId: file.id,
        storageKey: file.storageKey,
        contentType: file.contentType,
        bytes: file.bytes,
        extractionStatus: 'queued',
        ocrStatus: 'queued',
      },
    });
    ctx.cleanup.documentVersions.push(docVersion.id);

    const orch = await prisma.rfpOrchestration.create({
      data: {
        orgId: ctx.orgId!,
        rfpRequestId: opp.id,
        opportunityId: opp.id,
        documentVersionId: docVersion.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma enum cast for test fixture
        state: state as any,
        startedByUserId: ctx.userId ?? undefined,
      },
    });
    ctx.cleanup.rfpOrchestrations.push(orch.id);

    return { opp, file, bidDoc, docVersion, orch };
  }

  /** Create a foreign org + opportunity to test cross-org isolation. */
  async function createForeignOpportunity() {
    const foreignOrg = await prisma.org.create({
      data: {
        clerkOrg: `org_rfp_foreign_${randomUUID()}`,
        name: 'RFP Foreign Tenant',
      },
    });
    const foreignOpp = await prisma.opportunity.create({
      data: {
        orgId: foreignOrg.id,
        code: `XRFP-${randomUUID().slice(0, 8)}`,
        customer: 'Foreign Customer',
        name: 'Foreign RFP Opportunity',
        stage: 's1_lead',
      },
    });
    // Register for cleanup (opportunity FK cascades from org deletion).
    // We delete the org directly; FK cascade handles opportunity + any docs.
    return { foreignOrg, foreignOpp };
  }

  /** Create a proposal in the isolated org, optionally already approved. */
  async function createProposal(
    opts: {
      humanReviewRequired?: boolean;
      approvedAt?: Date | null;
    } = {},
  ) {
    const opp = await createOpportunity('approve-proposal');
    const proposal = await prisma.proposal.create({
      data: {
        orgId: ctx.orgId!,
        opportunityId: opp.id,
        name: `RFP Test Proposal ${randomUUID().slice(0, 8)}`,
        status: 'review',
        humanReviewRequired: opts.humanReviewRequired ?? true,
        approvedAt: opts.approvedAt !== undefined ? opts.approvedAt : null,
      },
    });
    ctx.cleanup.proposals.push(proposal.id);
    return { proposal, opp };
  }

  /**
   * Create a proposal that is wired to a real RFP orchestration sitting at the
   * final human-approval gate (state='awaiting_approval', qa_review completed,
   * proposalId linked) — the state RFP-GATE-001 requires before approval.
   * Override orchestrationState / completedPhases to exercise the negative paths.
   */
  async function createApprovableProposal(
    opts: {
      humanReviewRequired?: boolean;
      orchestrationState?: string;
      completedPhases?: string[];
      withOrchestration?: boolean;
    } = {},
  ) {
    const opp = await createOpportunity('approve-gate');
    const file = await createFile();

    const bidDoc = await prisma.bidDocument.create({
      data: {
        orgId: ctx.orgId!,
        opportunityId: opp.id,
        title: file.name,
        documentType: 'rfp',
        status: 'intake',
        source: 'upload',
      },
    });
    ctx.cleanup.bidDocuments.push(bidDoc.id);

    const docVersion = await prisma.documentVersion.create({
      data: {
        orgId: ctx.orgId!,
        bidDocumentId: bidDoc.id,
        versionNo: 1,
        fileAttachmentId: file.id,
        storageKey: file.storageKey,
        contentType: file.contentType,
        bytes: file.bytes,
        extractionStatus: 'queued',
        ocrStatus: 'queued',
      },
    });
    ctx.cleanup.documentVersions.push(docVersion.id);

    const proposal = await prisma.proposal.create({
      data: {
        orgId: ctx.orgId!,
        opportunityId: opp.id,
        name: `RFP Gate Proposal ${randomUUID().slice(0, 8)}`,
        status: 'review',
        humanReviewRequired: opts.humanReviewRequired ?? true,
      },
    });
    ctx.cleanup.proposals.push(proposal.id);

    let orch: { id: string } | null = null;
    if (opts.withOrchestration ?? true) {
      orch = await prisma.rfpOrchestration.create({
        data: {
          orgId: ctx.orgId!,
          rfpRequestId: opp.id,
          opportunityId: opp.id,
          documentVersionId: docVersion.id,
          proposalId: proposal.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma enum cast for test fixture
          state: (opts.orchestrationState ?? 'awaiting_approval') as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma enum array cast for test fixture
          completedPhases: (opts.completedPhases ?? ['qa_review']) as any,
          startedByUserId: ctx.userId ?? undefined,
        },
        select: { id: true },
      });
      ctx.cleanup.rfpOrchestrations.push(orch.id);
    }

    return { opp, file, bidDoc, docVersion, proposal, orch };
  }

  /**
   * Create a ReviewIssue blocker (defaults open/high). Pass `proposalId` to scope
   * it to a proposal's run — the approval gate reads blockers by proposalId.
   */
  async function createReviewIssue(
    opportunityId: string,
    opts: { severity?: string; status?: string; category?: string; proposalId?: string } = {},
  ) {
    const issue = await prisma.reviewIssue.create({
      data: {
        orgId: ctx.orgId!,
        opportunityId,
        proposalId: opts.proposalId ?? null,
        category: opts.category ?? 'rfp-review:legal',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma enum cast for test fixture
        severity: (opts.severity ?? 'high') as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma enum cast for test fixture
        status: (opts.status ?? 'open') as any,
        title: `Test blocker ${randomUUID().slice(0, 8)}`,
        description: 'Integration-test review issue',
      },
      select: { id: true },
    });
    ctx.cleanup.reviewIssues.push(issue.id);
    return issue;
  }

  return {
    ctx,
    skipIfNoDb,
    createOpportunity,
    createFile,
    createOrchestrationFixture,
    createForeignOpportunity,
    createProposal,
    createApprovableProposal,
    createReviewIssue,
  };
}
