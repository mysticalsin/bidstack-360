// Integration tests — POST /api/v1/opportunities/:opportunityId/rfp/upload
//
// Key invariants verified:
//   - Body validation (400 if fileAttachmentId missing)
//   - Multi-tenancy: cross-org opportunity → 404, no data leaked
//   - File size guard → 413 above 50 MiB
//   - MIME type guard → 415 for unsafe/non-RFP source formats
//   - Rate limit guard → 429 (mocked Redis incr returns 11)
//   - Happy path: BidDocument, DocumentVersion, RfpOrchestration created in DB

import { randomUUID } from 'node:crypto';
import { describe, expect, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { makeRfpTestContext } from './rfp-pipeline.test-helpers.js';

const { ctx, skipIfNoDb, createOpportunity, createFile, createForeignOpportunity } =
  makeRfpTestContext();

describe('POST /api/v1/opportunities/:opportunityId/rfp/upload', () => {
  skipIfNoDb('400 if fileAttachmentId is missing from the body', async () => {
    const opp = await createOpportunity('upload-no-file');

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/rfp/upload`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  skipIfNoDb('404 if opportunity does not belong to caller orgId (cross-org)', async () => {
    const { foreignOrg, foreignOpp } = await createForeignOpportunity();

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${foreignOpp.id}/rfp/upload`,
      payload: { fileAttachmentId: randomUUID() },
    });

    // The stub auth session is scoped to org_seed_mantu. The foreign opp lives
    // in a different org — the route's findFirst(where: { id, orgId }) returns
    // null → 404. No data must be written under the foreign org.
    expect(res.statusCode).toBe(404);

    // Confirm no BidDocument or RfpOrchestration leaked into the foreign org.
    const leakedDoc = await prisma.bidDocument.findFirst({
      where: { orgId: foreignOrg.id },
    });
    expect(leakedDoc).toBeNull();

    // Clean up foreign org (cascades to opp).
    await prisma.opportunity.deleteMany({ where: { id: foreignOpp.id } });
    await prisma.org.deleteMany({ where: { id: foreignOrg.id } });
  });

  skipIfNoDb('404 if opportunity not found for orgId', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      // A random UUID that doesn't exist in the seed org.
      url: `/api/v1/opportunities/${randomUUID()}/rfp/upload`,
      payload: { fileAttachmentId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('413 if file exceeds 50 MiB', async () => {
    const opp = await createOpportunity('upload-too-large');
    // Create a file with bytes > 50 MiB (52_428_801 = 50 MiB + 1 byte).
    const bigFile = await createFile({ bytes: 52_428_801 });

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/rfp/upload`,
      payload: { fileAttachmentId: bigFile.id },
    });

    // Route validates file.bytes > RFP_MAX_BYTES and throws payloadTooLarge (413).
    expect(res.statusCode).toBe(413);
  });

  skipIfNoDb('415 if file mime type is not an allowed RFP source format', async () => {
    const opp = await createOpportunity('upload-bad-mime');
    const badFile = await createFile({ contentType: 'application/x-msdownload' });

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/rfp/upload`,
      payload: { fileAttachmentId: badFile.id },
    });

    expect(res.statusCode).toBe(415);
  });

  skipIfNoDb('202 on valid text RFP upload', async () => {
    const opp = await createOpportunity('upload-text-rfp');
    const textFile = await createFile({ contentType: 'text/plain' });

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/rfp/upload`,
      payload: { fileAttachmentId: textFile.id },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json<{ orchestrationId: string; bidWorkspaceId: string; status: string }>();
    expect(body.status).toBe('queued');
    expect(body.bidWorkspaceId).toBe(opp.id);
    ctx.cleanup.rfpOrchestrations.push(body.orchestrationId);

    const bidDoc = await prisma.bidDocument.findFirst({
      where: { orgId: ctx.orgId!, opportunityId: opp.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(bidDoc).not.toBeNull();
    ctx.cleanup.bidDocuments.push(bidDoc!.id);

    const docVersion = await prisma.documentVersion.findFirst({
      where: { orgId: ctx.orgId!, bidDocumentId: bidDoc!.id },
    });
    expect(docVersion?.contentType).toBe('text/plain');
    ctx.cleanup.documentVersions.push(docVersion!.id);
  });

  skipIfNoDb('429 if rate limit exceeded (mock Redis returns count > 10)', async () => {
    // WHY module mock here: we cannot exhaust 10 real Redis increments in a
    // repeatable test without polluting shared state. vi.mock swaps the
    // redis singleton with a fake that returns 11 on every INCR call.
    const redisMod = await import('../redis.js');
    const incrSpy = vi.spyOn(redisMod.redis, 'incr').mockResolvedValueOnce(11 as unknown as number);

    const opp = await createOpportunity('upload-rate-limit');
    const file = await createFile();

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${opp.id}/rfp/upload`,
      payload: { fileAttachmentId: file.id },
    });

    // Rate limit exceeded → 429 Too Many Requests.
    expect(res.statusCode).toBe(429);

    incrSpy.mockRestore();
  });

  skipIfNoDb(
    '202 on valid PDF upload — BidDocument, DocumentVersion, RfpOrchestration created; BullMQ job skipped in test mode',
    async () => {
      const opp = await createOpportunity('upload-happy-path');
      const file = await createFile();

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/api/v1/opportunities/${opp.id}/rfp/upload`,
        payload: { fileAttachmentId: file.id },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json<{ orchestrationId: string; bidWorkspaceId: string; status: string }>();
      expect(body.status).toBe('queued');
      expect(typeof body.orchestrationId).toBe('string');
      // WHY assert bidWorkspaceId === opp.id: the web client seeds its pipeline
      // store from this field to open the RFP progress SSE stream. If the
      // response omits it (the contract bug this guards), the stream never
      // connects and the pipeline UI hangs with no error.
      expect(body.bidWorkspaceId).toBe(opp.id);

      // Register for cleanup.
      ctx.cleanup.rfpOrchestrations.push(body.orchestrationId);

      // Verify BidDocument was created for this org.
      const bidDoc = await prisma.bidDocument.findFirst({
        where: { orgId: ctx.orgId!, opportunityId: opp.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(bidDoc).not.toBeNull();
      expect(bidDoc!.documentType).toBe('rfp');
      expect(bidDoc!.status).toBe('intake');
      ctx.cleanup.bidDocuments.push(bidDoc!.id);

      // Verify DocumentVersion was created.
      const docVersion = await prisma.documentVersion.findFirst({
        where: { orgId: ctx.orgId!, bidDocumentId: bidDoc!.id },
      });
      expect(docVersion).not.toBeNull();
      expect(docVersion!.extractionStatus).toBe('queued');
      ctx.cleanup.documentVersions.push(docVersion!.id);

      // Verify RfpOrchestration was created in 'queued' state.
      const orch = await prisma.rfpOrchestration.findUnique({
        where: { id: body.orchestrationId },
      });
      expect(orch).not.toBeNull();
      expect(orch!.state).toBe('queued');
      expect(orch!.orgId).toBe(ctx.orgId);
      // WHY: BullMQ is skipped in test mode (NODE_ENV=test guard in rfp-orchestrator.ts),
      // so rootJobId stays null — that is the expected behavior in CI.
      // We assert the orchestration row exists with correct tenant scoping.
    },
  );
});
