// Integration tests for contractual management (MSAs/framework agreements).
// Pattern: cross-sell.integration.test.ts — buildServer + inject against the
// isolated org; fixtures cleaned up in afterAll.
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';
import { DOCUMENT_EXTRACT } from '@bidstack/shared';

import { closeDocumentExtractQueueForTest } from '../queues/document-extract.js';
import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
const ACCOUNT = 'contract-test-account';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('contract-agreements');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.contractAgreement.deleteMany({ where: { orgId, accountKey: ACCOUNT } });
    await prisma.auditLog.deleteMany({
      where: { orgId, action: { startsWith: 'contract_agreement.' } },
    });
  }
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

async function redisReachable(url: string): Promise<boolean> {
  const redis = new IORedis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

describe('contract agreement routes', () => {
  t('create (MSA with countries + rebate) → list → patch status → delete', async () => {
    const create = await server.inject({
      method: 'POST',
      url: '/api/contract-agreements',
      payload: {
        accountKey: ACCOUNT,
        kind: 'msa',
        reference: 'MSA-2026-001',
        countries: ['FR', 'de', 'es'],
        globalRebateBps: 750,
        currency: 'EUR',
        rateReviewSchedule: 'annual',
        rateCard: [
          { role: 'Senior Consultant', rateMicros: 800_000_000, unit: 'day' },
          { role: 'Architect', rateMicros: 1_100_000_000, unit: 'day' },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    const body = create.json() as {
      id: string;
      kind: string;
      countries: string[];
      globalRebateBps: number;
      status: string;
      rateCard: { role: string; rateMicros: number; unit: string }[];
      fieldSources: Record<
        string,
        { source: string; label: string; confidence: number | null; sourceFileId: string | null }
      >;
    };
    expect(body.kind).toBe('msa');
    // Country codes are normalized to uppercase ISO-2 by the schema.
    expect(body.countries).toEqual(['FR', 'DE', 'ES']);
    expect(body.globalRebateBps).toBe(750);
    expect(body.status).toBe('active');
    // Rate card round-trips (different MSAs carry different negotiated rates).
    expect(body.rateCard).toHaveLength(2);
    expect(body.rateCard[0]).toEqual({
      role: 'Senior Consultant',
      rateMicros: 800_000_000,
      unit: 'day',
    });
    expect(body.fieldSources.reference).toMatchObject({
      source: 'manual',
      label: 'Manual',
      confidence: 1,
      sourceFileId: null,
    });
    const id = body.id;

    const list = await server.inject({
      method: 'GET',
      url: `/api/contract-agreements?accountKey=${ACCOUNT}`,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);

    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/contract-agreements/${id}`,
      payload: { status: 'expired', globalRebateBps: 1000 },
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json() as { status: string; globalRebateBps: number };
    expect(patched.status).toBe('expired');
    expect(patched.globalRebateBps).toBe(1000);

    const del = await server.inject({ method: 'DELETE', url: `/api/contract-agreements/${id}` });
    expect(del.statusCode).toBe(204);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'contract_agreement.create', targetId: id },
    });
    expect(audit).not.toBeNull();
  });

  t('links a hosted source document and returns its name; rejects a foreign file', async () => {
    const file = await prisma.fileAttachment.create({
      data: {
        orgId: orgId!,
        accountId: ACCOUNT,
        name: 'MSA-Acme.pdf',
        contentType: 'application/pdf',
        bytes: 1234,
        storageKey: `${orgId}/${ACCOUNT}/test-msa.pdf`,
      },
    });
    try {
      const create = await server.inject({
        method: 'POST',
        url: '/api/contract-agreements',
        payload: {
          accountKey: ACCOUNT,
          kind: 'msa',
          reference: 'MSA-WITH-DOC',
          sourceFileId: file.id,
        },
      });
      expect(create.statusCode).toBe(201);
      const body = create.json() as {
        sourceFileId: string;
        sourceFileName: string;
        fieldSources: Record<
          string,
          { source: string; label: string; sourceFileId: string; sourceFileName: string }
        >;
      };
      expect(body.sourceFileId).toBe(file.id);
      expect(body.sourceFileName).toBe('MSA-Acme.pdf');
      expect(body.fieldSources.reference).toMatchObject({
        source: 'document',
        label: 'Document',
        sourceFileId: file.id,
        sourceFileName: 'MSA-Acme.pdf',
      });

      // A random (non-existent / foreign) file id is rejected.
      const bad = await server.inject({
        method: 'POST',
        url: '/api/contract-agreements',
        payload: {
          accountKey: ACCOUNT,
          kind: 'msa',
          reference: 'MSA-BAD-DOC',
          sourceFileId: '11111111-1111-4111-8111-111111111111',
        },
      });
      expect(bad.statusCode).toBe(400);

      const otherAccountFile = await prisma.fileAttachment.create({
        data: {
          orgId: orgId!,
          accountId: 'other-contract-account',
          name: 'MSA-Other.pdf',
          contentType: 'application/pdf',
          bytes: 2222,
          storageKey: `${orgId}/other-contract-account/test-msa.pdf`,
        },
      });
      const wrongAccount = await server.inject({
        method: 'POST',
        url: '/api/contract-agreements',
        payload: {
          accountKey: ACCOUNT,
          kind: 'msa',
          reference: 'MSA-WRONG-ACCOUNT-DOC',
          sourceFileId: otherAccountFile.id,
        },
      });
      expect(wrongAccount.statusCode).toBe(400);
      await prisma.fileAttachment.deleteMany({ where: { id: otherAccountFile.id } });
    } finally {
      await prisma.fileAttachment.deleteMany({ where: { id: file.id } });
    }
  });

  t('queues an extraction for an uploaded doc and polls it (worker skipped in test)', async () => {
    const file = await prisma.fileAttachment.create({
      data: {
        orgId: orgId!,
        accountId: ACCOUNT,
        name: 'MSA-extract.pdf',
        contentType: 'application/pdf',
        bytes: 2048,
        storageKey: `${orgId}/${ACCOUNT}/extract-msa.pdf`,
      },
    });
    let extractionId: string | null = null;
    try {
      const start = await server.inject({
        method: 'POST',
        url: '/api/contract-agreements/extract',
        payload: { fileId: file.id },
      });
      expect(start.statusCode).toBe(200);
      const res = start.json() as { id: string; fileId: string; status: string; draft: unknown };
      expect(res.fileId).toBe(file.id);
      // enqueue is skipped in test mode → the row stays pending, no worker run.
      expect(res.status).toBe('pending');
      expect(res.draft).toBeNull();
      extractionId = res.id;

      const poll = await server.inject({
        method: 'GET',
        url: `/api/contract-agreements/extractions/${extractionId}`,
      });
      expect(poll.statusCode).toBe(200);
      expect((poll.json() as { status: string }).status).toBe('pending');

      // A non-existent / foreign file id is rejected.
      const bad = await server.inject({
        method: 'POST',
        url: '/api/contract-agreements/extract',
        payload: { fileId: '11111111-1111-4111-8111-111111111111' },
      });
      expect(bad.statusCode).toBe(404);
    } finally {
      if (extractionId) await prisma.documentExtraction.deleteMany({ where: { id: extractionId } });
      await prisma.fileAttachment.deleteMany({ where: { id: file.id } });
    }
  });

  t('enqueues a real BullMQ contract extraction job when queue tests are enabled', async () => {
    const redisUrl = process.env.BIDSTACK_API_E2E_REDIS_URL ?? 'redis://localhost:6380/15';
    if (!(await redisReachable(redisUrl))) {
      console.warn(`[skip] contract extraction enqueue proof - Redis unavailable at ${redisUrl}`);
      return;
    }

    const previousRedisUrl = process.env.REDIS_URL;
    const previousQueueFlag = process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS;
    process.env.REDIS_URL = redisUrl;
    process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS = 'true';

    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue(DOCUMENT_EXTRACT.name, {
      connection,
      defaultJobOptions: DOCUMENT_EXTRACT.defaultJobOptions,
    });
    const file = await prisma.fileAttachment.create({
      data: {
        orgId: orgId!,
        accountId: ACCOUNT,
        name: 'MSA-queue.txt',
        contentType: 'text/plain',
        bytes: 2048,
        storageKey: `${orgId}/${ACCOUNT}/queue-msa.txt`,
      },
    });
    let extractionId: string | null = null;
    let jobId: string | null = null;

    try {
      const start = await server.inject({
        method: 'POST',
        url: '/api/contract-agreements/extract',
        payload: { fileId: file.id },
      });
      expect(start.statusCode).toBe(200);
      const res = start.json() as { id: string; fileId: string; status: string };
      extractionId = res.id;
      expect(res.fileId).toBe(file.id);
      expect(res.status).toBe('pending');

      jobId = [orgId!, file.id, extractionId].join('--');
      const job = await queue.getJob(jobId);
      expect(job, 'contract extraction route must enqueue a BullMQ job').not.toBeNull();
      expect(job?.name).toBe('document.extract');
      expect(job?.data).toMatchObject({
        orgId,
        accountId: ACCOUNT,
        documentId: file.id,
        extractionId,
        storageKey: file.storageKey,
        contentType: file.contentType,
        name: file.name,
        extractionKind: 'contract',
      });
    } finally {
      if (jobId) {
        const job = await queue.getJob(jobId);
        await job?.remove().catch(() => undefined);
      }
      if (extractionId) await prisma.documentExtraction.deleteMany({ where: { id: extractionId } });
      await prisma.fileAttachment.deleteMany({ where: { id: file.id } });
      await queue.close();
      await connection.quit();
      await closeDocumentExtractQueueForTest();
      if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousRedisUrl;
      if (previousQueueFlag === undefined) delete process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS;
      else process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS = previousQueueFlag;
    }
  });

  t('approves a completed extraction into an agreement and exposes review status', async () => {
    const file = await prisma.fileAttachment.create({
      data: {
        orgId: orgId!,
        accountId: ACCOUNT,
        name: 'MSA-review.pdf',
        contentType: 'application/pdf',
        bytes: 4096,
        storageKey: `${orgId}/${ACCOUNT}/review-msa.pdf`,
      },
    });
    const extraction = await prisma.documentExtraction.create({
      data: {
        orgId: orgId!,
        documentId: file.id,
        accountId: ACCOUNT,
        status: 'done',
        extractedData: {
          reference: 'MSA-REVIEW-001',
          kind: 'msa',
          countries: ['FR', 'DE'],
          currency: 'EUR',
          globalRebateBps: 750,
          effectiveDate: null,
          expiryDate: new Date('2028-12-31').toISOString(),
          rateReviewSchedule: 'annual',
          rateCard: [{ role: 'Architect', rateMicros: 1_100_000_000, unit: 'day' }],
          confidenceBps: 8500,
          warnings: ['AI-assisted extraction - review every field before saving.'],
        },
      },
    });
    let agreementId: string | null = null;
    try {
      const approve = await server.inject({
        method: 'POST',
        url: `/api/contract-agreements/extractions/${extraction.id}/approve`,
        payload: {
          accountKey: ACCOUNT,
          kind: 'msa',
          reference: 'MSA-REVIEWED-001',
          countries: ['FR', 'DE'],
          globalRebateBps: 750,
          currency: 'EUR',
          expiryDate: new Date('2028-12-31').toISOString(),
          rateReviewSchedule: 'annual',
          rateCard: [{ role: 'Architect', rateMicros: 1_100_000_000, unit: 'day' }],
          status: 'active',
        },
      });
      expect(approve.statusCode).toBe(201);
      const approved = approve.json() as {
        id: string;
        sourceFileId: string;
        sourceExtractionId: string;
        reference: string;
        fieldSources: Record<
          string,
          {
            source: string;
            label: string;
            confidence: number | null;
            sourceFileId: string;
            sourceFileName: string;
            sourceExtractionId: string;
          }
        >;
      };
      agreementId = approved.id;
      expect(approved.reference).toBe('MSA-REVIEWED-001');
      expect(approved.sourceFileId).toBe(file.id);
      expect(approved.sourceExtractionId).toBe(extraction.id);
      expect(approved.fieldSources.reference).toMatchObject({
        source: 'derived:llm',
        label: 'AI reviewed',
        confidence: 0.85,
        sourceFileId: file.id,
        sourceFileName: 'MSA-review.pdf',
        sourceExtractionId: extraction.id,
      });

      const poll = await server.inject({
        method: 'GET',
        url: `/api/contract-agreements/extractions/${extraction.id}`,
      });
      expect(poll.statusCode).toBe(200);
      const result = poll.json() as {
        reviewStatus: string;
        approvedAgreementId: string | null;
        source: string;
        confidenceBps: number | null;
        sourceFileName: string | null;
      };
      expect(result.reviewStatus).toBe('approved');
      expect(result.approvedAgreementId).toBe(agreementId);
      expect(result.source).toBe('llm');
      expect(result.confidenceBps).toBe(8500);
      expect(result.sourceFileName).toBe('MSA-review.pdf');

      const duplicate = await server.inject({
        method: 'POST',
        url: `/api/contract-agreements/extractions/${extraction.id}/approve`,
        payload: {
          accountKey: ACCOUNT,
          kind: 'msa',
          reference: 'MSA-REVIEWED-001',
          countries: ['FR'],
          currency: 'EUR',
          rateReviewSchedule: 'annual',
        },
      });
      expect(duplicate.statusCode).toBe(409);
    } finally {
      if (agreementId) await prisma.contractAgreement.deleteMany({ where: { id: agreementId } });
      await prisma.documentExtraction.deleteMany({ where: { id: extraction.id } });
      await prisma.fileAttachment.deleteMany({ where: { id: file.id } });
    }
  });

  t('rejects pending extraction provenance until a reviewable draft exists', async () => {
    const file = await prisma.fileAttachment.create({
      data: {
        orgId: orgId!,
        accountId: ACCOUNT,
        name: 'MSA-pending.pdf',
        contentType: 'application/pdf',
        bytes: 2048,
        storageKey: `${orgId}/${ACCOUNT}/pending-msa.pdf`,
      },
    });
    const extraction = await prisma.documentExtraction.create({
      data: {
        orgId: orgId!,
        documentId: file.id,
        accountId: ACCOUNT,
        status: 'pending',
        extractedData: {},
      },
    });
    try {
      const create = await server.inject({
        method: 'POST',
        url: '/api/contract-agreements',
        payload: {
          accountKey: ACCOUNT,
          kind: 'msa',
          reference: 'MSA-PENDING-SHOULD-NOT-LINK',
          sourceExtractionId: extraction.id,
        },
      });
      expect(create.statusCode).toBe(409);
    } finally {
      await prisma.documentExtraction.deleteMany({ where: { id: extraction.id } });
      await prisma.fileAttachment.deleteMany({ where: { id: file.id } });
    }
  });

  t('another org’s contract id 404s on patch and delete (tenant isolation)', async () => {
    const foreignOrg = await prisma.org.create({
      data: { name: 'Contract Foreign', clerkOrg: `org_ctr_${Date.now()}` },
    });
    const foreign = await prisma.contractAgreement.create({
      data: {
        orgId: foreignOrg.id,
        accountKey: 'foreign',
        kind: 'framework',
        reference: 'X',
        countries: [],
        currency: 'EUR',
        rateReviewSchedule: 'annual',
        status: 'active',
        createdById: foreignOrg.id, // any uuid; FK is org-scoped on read
      },
    });
    try {
      const patch = await server.inject({
        method: 'PATCH',
        url: `/api/contract-agreements/${foreign.id}`,
        payload: { status: 'expired' },
      });
      expect(patch.statusCode).toBe(404);
      const del = await server.inject({
        method: 'DELETE',
        url: `/api/contract-agreements/${foreign.id}`,
      });
      expect(del.statusCode).toBe(404);
    } finally {
      await prisma.contractAgreement.deleteMany({ where: { orgId: foreignOrg.id } });
      await prisma.org.delete({ where: { id: foreignOrg.id } });
    }
  });
});
