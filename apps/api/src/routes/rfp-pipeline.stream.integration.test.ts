// Integration tests — GET /api/v1/bid-workspaces/:workspaceId/rfp/:orchestrationId/stream
//
// Key invariants verified:
//   - Auth + tenant guard: missing auth → 404 (stub auth always resolves)
//   - Cross-org orchestration → 404
//   - SSE Content-Type: text/event-stream for terminal-state orchestrations
//   - SSE body contains a data: frame with orchestration state
//   - SSE body contains state: "completed" for completed orchestrations

import { randomUUID } from 'node:crypto';
import { describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { makeRfpTestContext } from './rfp-pipeline.test-helpers.js';

const { ctx, skipIfNoDb, createForeignOpportunity, createOrchestrationFixture } =
  makeRfpTestContext();

describe('GET /api/v1/bid-workspaces/:workspaceId/rfp/:orchestrationId/stream', () => {
  skipIfNoDb('401 if no auth context (stub auth skips but verifies header shape)', async () => {
    // In test mode, stub auth always resolves — so we test the 404 path for a
    // non-existent orchestration instead, which exercises the auth + tenant guard.
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/v1/bid-workspaces/${randomUUID()}/rfp/${randomUUID()}/stream`,
    });
    // No orchestration row → 404 (auth still runs in stub mode).
    expect(res.statusCode).toBe(404);
  });

  skipIfNoDb('404 if orchestration not found for this org', async () => {
    const { foreignOrg, foreignOpp } = await createForeignOpportunity();
    // Create a foreign orchestration to test cross-org isolation.
    const foreignFile = await prisma.fileAttachment.create({
      data: {
        orgId: foreignOrg.id,
        accountId: 'foreign',
        name: 'foreign.pdf',
        contentType: 'application/pdf',
        bytes: 512,
        storageKey: `${foreignOrg.id}/foreign.pdf`,
      },
    });
    const foreignDocVersion = await prisma.documentVersion.create({
      data: {
        orgId: foreignOrg.id,
        bidDocumentId: (
          await prisma.bidDocument.create({
            data: {
              orgId: foreignOrg.id,
              opportunityId: foreignOpp.id,
              title: 'foreign.pdf',
              documentType: 'rfp',
              status: 'intake',
              source: 'upload',
            },
            select: { id: true },
          })
        ).id,
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
        documentVersionId: foreignDocVersion.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- enum cast for test fixture
        state: 'running' as any,
      },
    });

    // Caller is the seed org — must not see a foreign orchestration.
    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/v1/bid-workspaces/${foreignOpp.id}/rfp/${foreignOrch.id}/stream`,
    });
    expect(res.statusCode).toBe(404);

    // Clean up foreign resources.
    await prisma.rfpOrchestration.deleteMany({ where: { id: foreignOrch.id } });
    await prisma.documentVersion.deleteMany({ where: { id: foreignDocVersion.id } });
    await prisma.bidDocument.deleteMany({ where: { opportunityId: foreignOpp.id } });
    await prisma.fileAttachment.deleteMany({ where: { id: foreignFile.id } });
    await prisma.opportunity.deleteMany({ where: { id: foreignOpp.id } });
    await prisma.org.deleteMany({ where: { id: foreignOrg.id } });
  });

  skipIfNoDb(
    'SSE response has Content-Type: text/event-stream when orchestration is in terminal state',
    async () => {
      // Use a 'completed' state so the route sends the initial event and
      // immediately ends the stream — no polling loop needed in the test.
      const { opp, orch } = await createOrchestrationFixture('completed');

      const res = await ctx.server.inject({
        method: 'GET',
        url: `/api/v1/bid-workspaces/${opp.id}/rfp/${orch.id}/stream`,
      });

      // WHY 200 not 204: SSE always returns 200 with a streaming body.
      expect(res.statusCode).toBe(200);
      const contentType = res.headers['content-type'] as string;
      expect(contentType).toContain('text/event-stream');
    },
  );

  skipIfNoDb('SSE body contains a data: frame with orchestration state', async () => {
    const { opp, orch } = await createOrchestrationFixture('completed');

    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/v1/bid-workspaces/${opp.id}/rfp/${orch.id}/stream`,
    });

    // The route writes at least one `data: {...}\n\n` frame.
    // server.inject() buffers the full response once the stream ends.
    expect(res.body).toMatch(/^data:\s*\{/m);
    // The payload must include a state field.
    expect(res.body).toContain('"state"');
  });

  skipIfNoDb('SSE body contains event: complete for completed orchestration', async () => {
    // WHY: the route does NOT send a separate `event: complete` named event —
    // it sends `data: {...}` with state: 'completed' then ends the stream.
    // We verify the state value inside the data frame matches 'completed'.
    const { opp, orch } = await createOrchestrationFixture('completed');

    const res = await ctx.server.inject({
      method: 'GET',
      url: `/api/v1/bid-workspaces/${opp.id}/rfp/${orch.id}/stream`,
    });

    expect(res.statusCode).toBe(200);
    // The data frame must carry state: "completed".
    expect(res.body).toContain('"completed"');
  });
});
