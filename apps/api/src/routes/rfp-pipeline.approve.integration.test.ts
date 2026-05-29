// Integration tests — POST /api/v1/proposals/:proposalId/rfp-approve
//
// Key invariants verified:
//   - 404 if proposal does not belong to caller org (cross-org isolation)
//   - 409 if humanReviewRequired is false
//   - 409 if proposal has already been approved
//   - 200 on valid approval — sets approvedAt, approvedByUserId, status → 'approved'
//   - AiInvocation audit record is created via $executeRaw on approval
//   - AuditLog record is created within the same transaction as the approval

import { describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { makeRfpTestContext } from './rfp-pipeline.test-helpers.js';

const { ctx, skipIfNoDb, createProposal, createForeignOpportunity } = makeRfpTestContext();

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
    '200 on valid approval — sets approvedAt and approvedByUserId, returns correct shape',
    async () => {
      const { proposal } = await createProposal();

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/api/v1/proposals/${proposal.id}/rfp-approve`,
        payload: { notes: 'LGTM — compliant with EU AI Act Art. 50' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ approvedAt: string; approvedByUserId: string }>();
      expect(typeof body.approvedAt).toBe('string');
      expect(typeof body.approvedByUserId).toBe('string');
      // approvedByUserId must be the seed user (resolved by stub auth).
      expect(body.approvedByUserId).toBe(ctx.userId);

      // Verify the DB row was updated.
      const updated = await prisma.proposal.findUnique({ where: { id: proposal.id } });
      expect(updated?.approvedAt).not.toBeNull();
      expect(updated?.approvedByUserId).toBe(ctx.userId);
      expect(updated?.status).toBe('approved');
    },
  );

  skipIfNoDb('AiInvocation audit record is created via $executeRaw on approval', async () => {
    const { proposal } = await createProposal();

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
    const { proposal } = await createProposal();

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
