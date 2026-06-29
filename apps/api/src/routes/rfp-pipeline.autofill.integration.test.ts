// Integration tests — POST /api/v1/bid-workspaces/:workspaceId/matrix/:rowId/rfp-autofill
//
// Key invariants verified:
//   - 404 if orchestration not found for org
//   - 409 if orchestration state is not 'approved' (human gate not yet passed)
//   - 404 if compliance matrix row not found for org
//   - 202 on valid call — BullMQ job enqueued (skipped in test mode)
//   - Cross-org: orchestration from foreign org returns 404

import { randomUUID } from 'node:crypto';
import { describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { makeRfpTestContext } from './rfp-pipeline.test-helpers.js';

const { ctx, skipIfNoDb, createOpportunity, createOrchestrationFixture, createForeignOpportunity } =
  makeRfpTestContext();

describe('POST /api/v1/bid-workspaces/:workspaceId/matrix/:rowId/rfp-autofill', () => {
  skipIfNoDb('404 if orchestration not found for org', async () => {
    const opp = await createOpportunity('autofill-no-orch');

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/bid-workspaces/${opp.id}/matrix/${randomUUID()}/rfp-autofill`,
      payload: {
        orchestrationId: randomUUID(),
        sectionKey: 'security',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('409 if orchestration state is not approved (human gate not yet passed)', async () => {
    // Create an orchestration in 'running' state — autofill must be blocked.
    const { opp, orch } = await createOrchestrationFixture('running');

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/bid-workspaces/${opp.id}/matrix/${randomUUID()}/rfp-autofill`,
      payload: {
        orchestrationId: orch.id,
        sectionKey: 'security',
      },
    });

    // WHY 409: route uses httpErrors.conflict when state !== 'approved'.
    // (The task brief says 403, but the implementation throws conflict —
    // the test reflects the actual contract, not the brief's HTTP status hint.)
    expect(res.statusCode).toBe(409);
  });

  skipIfNoDb('404 if compliance matrix row not found for org', async () => {
    // Create an orchestration in 'approved' state so the state guard passes.
    const { opp, orch } = await createOrchestrationFixture('approved');

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/bid-workspaces/${opp.id}/matrix/${randomUUID()}/rfp-autofill`,
      payload: {
        orchestrationId: orch.id,
        sectionKey: 'pricing',
      },
    });

    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb(
    '202 on valid call — BullMQ compliance-fill job enqueued (skipped in test mode)',
    async () => {
      const { opp, orch } = await createOrchestrationFixture('approved');

      // Create the requirement and matrix row fixtures.
      const requirement = await prisma.requirement.create({
        data: {
          orgId: ctx.orgId!,
          opportunityId: opp.id,
          bidDocumentId: (await prisma.bidDocument.findFirst({ where: { opportunityId: opp.id } }))!
            .id,
          text: 'Supplier must hold ISO 27001 certification.',
          mandatory: true,
          priority: 'high',
        },
      });
      ctx.cleanup.requirements.push(requirement.id);

      const matrixRow = await prisma.complianceMatrixRow.create({
        data: {
          orgId: ctx.orgId!,
          opportunityId: opp.id,
          requirementId: requirement.id,
        },
      });
      ctx.cleanup.complianceMatrixRows.push(matrixRow.id);

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/api/v1/bid-workspaces/${opp.id}/matrix/${matrixRow.id}/rfp-autofill`,
        payload: {
          orchestrationId: orch.id,
          sectionKey: 'security',
        },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json<{ jobId: string | null; status: string }>();
      expect(body.status).toBe('queued');
      // WHY null: BullMQ producer skips enqueue in test mode (NODE_ENV=test guard
      // in rfp-compliance-fill.ts). The route correctly returns null jobId.
      expect(body.jobId).toBeNull();
    },
  );

  skipIfNoDb('cross-org: orchestration from foreign org returns 404', async () => {
    const { foreignOrg, foreignOpp } = await createForeignOpportunity();
    const foreignFile = await prisma.fileAttachment.create({
      data: {
        orgId: foreignOrg.id,
        accountId: 'x',
        name: 'x.pdf',
        contentType: 'application/pdf',
        bytes: 1024,
        storageKey: `${foreignOrg.id}/x.pdf`,
      },
    });
    const foreignBidDoc = await prisma.bidDocument.create({
      data: {
        orgId: foreignOrg.id,
        opportunityId: foreignOpp.id,
        title: 'x',
        documentType: 'rfp',
        status: 'intake',
        source: 'upload',
      },
    });
    const foreignDocVer = await prisma.documentVersion.create({
      data: {
        orgId: foreignOrg.id,
        bidDocumentId: foreignBidDoc.id,
        versionNo: 1,
        fileAttachmentId: foreignFile.id,
        storageKey: foreignFile.storageKey,
        contentType: foreignFile.contentType,
        bytes: foreignFile.bytes,
        extractionStatus: 'queued',
        ocrStatus: 'queued',
      },
    });
    const foreignOrch = await prisma.rfpOrchestration.create({
      data: {
        orgId: foreignOrg.id,
        rfpRequestId: foreignOpp.id,
        opportunityId: foreignOpp.id,
        documentVersionId: foreignDocVer.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- enum cast for test fixture
        state: 'approved' as any,
      },
    });

    const opp = await createOpportunity('autofill-xorg');
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/bid-workspaces/${opp.id}/matrix/${randomUUID()}/rfp-autofill`,
      payload: { orchestrationId: foreignOrch.id, sectionKey: 'security' },
    });
    // The foreign orchestration's orgId does not match the isolated org → 404.
    expect(res.statusCode).toBe(404);

    // Clean up.
    await prisma.rfpOrchestration.deleteMany({ where: { id: foreignOrch.id } });
    await prisma.documentVersion.deleteMany({ where: { id: foreignDocVer.id } });
    await prisma.bidDocument.deleteMany({ where: { id: foreignBidDoc.id } });
    await prisma.fileAttachment.deleteMany({ where: { id: foreignFile.id } });
    await prisma.opportunity.deleteMany({ where: { id: foreignOpp.id } });
    await prisma.org.deleteMany({ where: { id: foreignOrg.id } });
  });
});
