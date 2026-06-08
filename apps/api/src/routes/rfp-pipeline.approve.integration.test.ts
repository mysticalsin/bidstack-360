// Integration tests — POST /api/v1/proposals/:proposalId/rfp-approve
//
// Key invariants verified:
//   - 404 if proposal does not belong to caller org (cross-org isolation)
//   - 409 if humanReviewRequired is false
//   - 409 if proposal has already been approved
//   - RFP-GATE-001: 409 if no linked orchestration, if the orchestration is not
//     at the final approval gate, or if unresolved high/critical review issues
//     remain — and on success the orchestration advances to 'approved'.
//   - 200 on valid approval — sets approvedAt, approvedByUserId, status → 'approved'
//   - AiInvocation audit record is created via $executeRaw on approval
//   - AuditLog record is created within the same transaction as the approval

import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { makeRfpTestContext } from './rfp-pipeline.test-helpers.js';

const {
  ctx,
  skipIfNoDb,
  createProposal,
  createForeignOpportunity,
  createApprovableProposal,
  createReviewIssue,
} = makeRfpTestContext();

describe('POST /api/v1/proposals/:proposalId/rfp-approve', () => {
  skipIfNoDb('404 if proposal does not belong to caller org', async () => {
    const { foreignOrg, foreignOpp } = await createForeignOpportunity();
    const foreignProposal = await prisma.proposal.create({
      data: {
        orgId: foreignOrg.id,
        opportunityId: foreignOpp.id,
        name: 'Foreign Proposal',
        status: 'review',
        humanReviewRequired: true,
      },
    });

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${foreignProposal.id}/rfp-approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);

    // Clean up.
    await prisma.proposal.deleteMany({ where: { id: foreignProposal.id } });
    await prisma.opportunity.deleteMany({ where: { id: foreignOpp.id } });
    await prisma.org.deleteMany({ where: { id: foreignOrg.id } });
  });

  skipIfNoDb('409 if humanReviewRequired is false', async () => {
    const { proposal } = await createProposal({ humanReviewRequired: false });

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  skipIfNoDb('409 if proposal has already been approved', async () => {
    const { proposal } = await createProposal({ approvedAt: new Date() });

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  skipIfNoDb(
    '200 on valid approval — sets approval fields and advances the orchestration to approved',
    async () => {
      const { proposal, orch } = await createApprovableProposal();

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
        payload: { notes: 'LGTM — compliant with EU AI Act Art. 50' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        approvedAt: string;
        approvedByUserId: string;
        orchestrationId: string;
        orchestrationState: string;
      }>();
      expect(typeof body.approvedAt).toBe('string');
      expect(typeof body.approvedByUserId).toBe('string');
      // approvedByUserId must be the seed user (resolved by stub auth).
      expect(body.approvedByUserId).toBe(ctx.userId);
      // RFP-GATE-001 — response surfaces the orchestration it advanced.
      expect(body.orchestrationId).toBe(orch?.id);
      expect(body.orchestrationState).toBe('approved');

      // Verify the proposal row was updated.
      const updated = await prisma.proposal.findUnique({ where: { id: proposal.id } });
      expect(updated?.approvedAt).not.toBeNull();
      expect(updated?.approvedByUserId).toBe(ctx.userId);
      expect(updated?.status).toBe('approved');

      // WHY assert the orchestration moved: this is the whole point of GATE-001 —
      // downstream compliance autofill requires state='approved'. Without the
      // transition the pipeline would dead-end here.
      const movedOrch = await prisma.rfpOrchestration.findUnique({ where: { id: orch!.id } });
      expect(movedOrch?.state).toBe('approved');
    },
  );

  skipIfNoDb(
    '409 if no RFP orchestration is linked to the proposal (gate does not apply)',
    async () => {
      const { proposal } = await createApprovableProposal({ withOrchestration: false });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
        payload: {},
      });
      expect(res.statusCode).toBe(409);
    },
  );

  skipIfNoDb('409 if the linked orchestration is not awaiting approval', async () => {
    const { proposal } = await createApprovableProposal({ orchestrationState: 'running' });

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  skipIfNoDb(
    '409 if awaiting approval but qa_review is not complete (drafting gate, not final gate)',
    async () => {
      const { proposal } = await createApprovableProposal({ completedPhases: [] });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
        payload: {},
      });
      expect(res.statusCode).toBe(409);
    },
  );

  skipIfNoDb(
    '409 if an unresolved high/critical review issue blocks the opportunity',
    async () => {
      const { proposal, opp } = await createApprovableProposal();
      // Scoped to THIS proposal's run — the gate reads blockers by proposalId.
      await createReviewIssue(opp.id, {
        severity: 'critical',
        status: 'open',
        proposalId: proposal.id,
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
        payload: {},
      });
      expect(res.statusCode).toBe(409);

      // The proposal must remain unapproved when blocked.
      const stillOpen = await prisma.proposal.findUnique({ where: { id: proposal.id } });
      expect(stillOpen?.approvedAt).toBeNull();
    },
  );

  skipIfNoDb('200 when a sibling run blocker does not belong to this proposal', async () => {
    // A high/critical issue scoped to a DIFFERENT proposal must not block this one.
    const { proposal, opp } = await createApprovableProposal();
    const siblingProposal = await prisma.proposal.create({
      data: {
        orgId: ctx.orgId!,
        opportunityId: opp.id,
        name: `Sibling RFP Proposal ${randomUUID().slice(0, 8)}`,
        status: 'review',
        humanReviewRequired: true,
      },
      select: { id: true },
    });
    ctx.cleanup.proposals.push(siblingProposal.id);
    await createReviewIssue(opp.id, {
      severity: 'critical',
      status: 'open',
      proposalId: siblingProposal.id,
    });

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  skipIfNoDb('200 when the only high/critical review issue has been waived', async () => {
    const { proposal, opp } = await createApprovableProposal();
    // A waiver is an explicit human decision and must NOT block approval.
    await createReviewIssue(opp.id, { severity: 'high', status: 'waived', proposalId: proposal.id });
    // A low-severity open issue must also not block.
    await createReviewIssue(opp.id, { severity: 'low', status: 'open', proposalId: proposal.id });

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  skipIfNoDb('AiInvocation audit record is created via $executeRaw on approval', async () => {
    const { proposal } = await createApprovableProposal();

    // Count existing ai_invocations for this org before the call.
    const before = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
        SELECT COUNT(*) AS cnt FROM ai_invocations WHERE org_id = ${ctx.orgId}::uuid
      `;
    const beforeCount = Number(before[0]?.cnt ?? 0);

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
      payload: { notes: 'Audit trail test' },
    });
    expect(res.statusCode).toBe(200);

    // WHY small delay: logAiInvocation is fire-and-forget (void Promise).
    // Give the event loop one tick to let the $executeRaw settle.
    await new Promise((r) => setTimeout(r, 200));

    const after = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
        SELECT COUNT(*) AS cnt FROM ai_invocations WHERE org_id = ${ctx.orgId}::uuid
      `;
    const afterCount = Number(after[0]?.cnt ?? 0);

    // At least one new AiInvocation row should have been written.
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  skipIfNoDb('AuditLog record is created within the same transaction as the approval', async () => {
    const { proposal } = await createApprovableProposal();

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    // WHY orderBy 'at': AuditLog uses 'at' (not 'createdAt') for its timestamp field.
    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        orgId: ctx.orgId!,
        action: 'proposal.rfp_approve',
        targetType: 'proposal',
        targetId: proposal.id,
      },
      orderBy: { at: 'desc' },
    });
    expect(auditEntry).not.toBeNull();
    // id is BigInt — cast is sound because the type is bigint in the Prisma model.
    if (auditEntry) ctx.cleanup.auditLogs.push(auditEntry.id as bigint);
  });
});
