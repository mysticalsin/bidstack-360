import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Queue, type Worker } from 'bullmq';
import { prisma } from '@bidstack/db';
import {
  ContractExtractionDraft,
  DOCUMENT_EXTRACT,
  type ContractExtractionDraft as ContractExtractionDraftData,
} from '@bidstack/shared';
import IORedis from 'ioredis';
import pino from 'pino';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  processDocumentExtractJobForTest,
  startDocumentExtract,
  type DocumentExtractJobData,
} from './document-extract.js';

let dbReachable = false;
const tempRoots: string[] = [];
let previousLocalRoot: string | undefined;
let previousStorageDriver: string | undefined;
let previousLlmProvider: string | undefined;
let previousRedisUrl: string | undefined;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterEach(async () => {
  if (previousLocalRoot === undefined) delete process.env.LOCAL_STORAGE_ROOT;
  else process.env.LOCAL_STORAGE_ROOT = previousLocalRoot;
  if (previousStorageDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = previousStorageDriver;
  if (previousLlmProvider === undefined) delete process.env.RFP_LLM_PROVIDER;
  else process.env.RFP_LLM_PROVIDER = previousLlmProvider;
  if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previousRedisUrl;
  previousLocalRoot = undefined;
  previousStorageDriver = undefined;
  previousLlmProvider = undefined;
  previousRedisUrl = undefined;
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

async function waitForDraft(extractionId: string): Promise<ContractExtractionDraftData> {
  const deadline = Date.now() + 15_000;
  let lastStatus = 'missing';
  while (Date.now() < deadline) {
    const row = await prisma.documentExtraction.findUnique({ where: { id: extractionId } });
    lastStatus = row?.status ?? 'missing';
    if (row?.status === 'done') return ContractExtractionDraft.parse(row.extractedData);
    if (row?.status === 'error') throw new Error(`Extraction failed: ${row.error ?? 'unknown'}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for extraction ${extractionId}; last status=${lastStatus}`);
}

async function createStoredContractFixture() {
  const root = path.join(tmpdir(), `bidstack-contract-worker-${Date.now()}-${Math.random()}`);
  tempRoots.push(root);
  process.env.LOCAL_STORAGE_ROOT = root;

  const org = await prisma.org.create({
    data: { name: 'Worker Contract Test', clerkOrg: `org_worker_contract_${Date.now()}` },
  });
  const accountId = `worker-contract-${Date.now()}`;
  const storageKey = `${org.id}/${accountId}/msa-worker.txt`;
  const source = `
MASTER SERVICES AGREEMENT
Reference: MSA-WORKER-001
Countries: FR, DE, ES
Currency: EUR
This agreement grants a global rebate of 7.5% on all services.
Effective date: 2026-01-01
Expiry date: 2028-12-31
Rate review: annual

Rate card
Senior Consultant     800 / day
Solution Architect:   1100 per day
Project Manager       95 /hour
`;

  await mkdir(path.dirname(path.join(root, storageKey)), { recursive: true });
  await writeFile(path.join(root, storageKey), source);

  const file = await prisma.fileAttachment.create({
    data: {
      orgId: org.id,
      accountId,
      name: 'MSA-worker.txt',
      contentType: 'text/plain',
      bytes: Buffer.byteLength(source),
      storageKey,
    },
  });
  const extraction = await prisma.documentExtraction.create({
    data: {
      orgId: org.id,
      documentId: file.id,
      accountId,
      status: 'pending',
      extractedData: {},
    },
  });
  const job: DocumentExtractJobData = {
    orgId: org.id,
    accountId,
    documentId: file.id,
    extractionId: extraction.id,
    storageKey,
    contentType: 'text/plain',
    name: file.name,
    extractionKind: 'contract',
  };
  return { org, accountId, file, extraction, job };
}

async function cleanupContractFixture(orgId: string, accountId: string) {
  await prisma.contractAgreement.deleteMany({ where: { orgId, accountKey: accountId } });
  await prisma.accountSolution.deleteMany({ where: { orgId, accountId } });
  await prisma.accountProduct.deleteMany({ where: { orgId, accountId } });
  await prisma.documentExtraction.deleteMany({ where: { orgId } });
  await prisma.fileAttachment.deleteMany({ where: { orgId } });
  await prisma.org.delete({ where: { id: orgId } });
}

async function createStoredIntelFixture() {
  const root = path.join(tmpdir(), `bidstack-intel-worker-${Date.now()}-${Math.random()}`);
  tempRoots.push(root);
  process.env.LOCAL_STORAGE_ROOT = root;

  const org = await prisma.org.create({
    data: { name: 'Worker Intel Test', clerkOrg: `org_worker_intel_${Date.now()}` },
  });
  const accountId = `worker-intel-${Date.now()}`;
  const storageKey = `${org.id}/${accountId}/intel-source.txt`;
  const source = `
Solutions:
- Cloud migration solution - landing-zone modernization and application migration

Products:
- Managed workspace platform - device, identity, and collaboration management
`;

  await mkdir(path.dirname(path.join(root, storageKey)), { recursive: true });
  await writeFile(path.join(root, storageKey), source);

  const file = await prisma.fileAttachment.create({
    data: {
      orgId: org.id,
      accountId,
      name: 'intel-source.txt',
      contentType: 'text/plain',
      bytes: Buffer.byteLength(source),
      storageKey,
    },
  });
  const extraction = await prisma.documentExtraction.create({
    data: {
      orgId: org.id,
      documentId: file.id,
      accountId,
      status: 'pending',
      extractedData: {},
    },
  });
  const job: DocumentExtractJobData = {
    orgId: org.id,
    accountId,
    documentId: file.id,
    extractionId: extraction.id,
    storageKey,
    contentType: 'text/plain',
    name: file.name,
  };
  return { org, accountId, file, extraction, job };
}

function expectContractDraft(draft: ContractExtractionDraftData) {
  expect(draft.reference).toBe('MSA-WORKER-001');
  expect(draft.kind).toBe('msa');
  expect(draft.countries).toEqual(expect.arrayContaining(['FR', 'DE', 'ES']));
  expect(draft.currency).toBe('EUR');
  expect(draft.globalRebateBps).toBe(750);
  expect(draft.rateReviewSchedule).toBe('annual');
  expect(draft.rateCard).toEqual(
    expect.arrayContaining([
      { role: 'Senior Consultant', rateMicros: 800_000_000, unit: 'day' },
      { role: 'Solution Architect', rateMicros: 1_100_000_000, unit: 'day' },
    ]),
  );
  expect(draft.warnings.some((warning) => /review/i.test(warning))).toBe(true);
}

describe('document-extract contract lane', () => {
  it('persists durable source metadata on extracted account-intel artifacts', async () => {
    if (!dbReachable) {
      console.warn('[skip] document-extract account intel provenance - DB unavailable');
      return;
    }

    previousLocalRoot = process.env.LOCAL_STORAGE_ROOT;
    previousStorageDriver = process.env.STORAGE_DRIVER;
    process.env.STORAGE_DRIVER = 'local';

    const { org, accountId, file, extraction, job } = await createStoredIntelFixture();

    try {
      await processDocumentExtractJobForTest(job, pino({ level: 'silent' }));

      const solution = await prisma.accountSolution.findFirstOrThrow({
        where: { orgId: org.id, accountId },
      });
      const product = await prisma.accountProduct.findFirstOrThrow({
        where: { orgId: org.id, accountId },
      });

      expect(solution.metadata).toMatchObject({
        source: {
          type: 'document_extraction',
          extractionId: extraction.id,
          documentId: file.id,
          extractor: 'deterministic',
          dustRunId: null,
        },
      });
      expect(product.metadata).toMatchObject({
        source: {
          type: 'document_extraction',
          extractionId: extraction.id,
          documentId: file.id,
          extractor: 'deterministic',
          dustRunId: null,
        },
      });
    } finally {
      await cleanupContractFixture(org.id, accountId);
    }
  });

  it('turns a stored MSA document into a reviewable contract draft without writing intel artifacts', async () => {
    if (!dbReachable) {
      console.warn('[skip] document-extract contract lane - DB unavailable');
      return;
    }

    previousLocalRoot = process.env.LOCAL_STORAGE_ROOT;
    previousStorageDriver = process.env.STORAGE_DRIVER;
    previousLlmProvider = process.env.RFP_LLM_PROVIDER;
    process.env.STORAGE_DRIVER = 'local';
    process.env.RFP_LLM_PROVIDER = '';

    const { org, accountId, extraction, job } = await createStoredContractFixture();

    try {
      await processDocumentExtractJobForTest(job, pino({ level: 'silent' }));

      const updated = await prisma.documentExtraction.findUniqueOrThrow({
        where: { id: extraction.id },
      });
      expect(updated.status).toBe('done');

      const parsed = ContractExtractionDraft.safeParse(updated.extractedData);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expectContractDraft(parsed.data);

      await expect(
        prisma.accountSolution.count({ where: { orgId: org.id, accountId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.accountProduct.count({ where: { orgId: org.id, accountId } }),
      ).resolves.toBe(0);
    } finally {
      await cleanupContractFixture(org.id, accountId);
    }
  });

  it('processes the contract lane through BullMQ and the document-extract worker', async () => {
    if (!dbReachable) {
      console.warn('[skip] document-extract BullMQ contract lane - DB unavailable');
      return;
    }
    const redisUrl = process.env.BIDSTACK_WORKER_E2E_REDIS_URL ?? 'redis://localhost:6380/15';
    if (!(await redisReachable(redisUrl))) {
      console.warn(`[skip] document-extract BullMQ contract lane - Redis unavailable at ${redisUrl}`);
      return;
    }

    previousLocalRoot = process.env.LOCAL_STORAGE_ROOT;
    previousStorageDriver = process.env.STORAGE_DRIVER;
    previousLlmProvider = process.env.RFP_LLM_PROVIDER;
    previousRedisUrl = process.env.REDIS_URL;
    process.env.STORAGE_DRIVER = 'local';
    process.env.RFP_LLM_PROVIDER = '';
    process.env.REDIS_URL = redisUrl;

    const { org, accountId, extraction, job } = await createStoredContractFixture();
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const queueConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue<DocumentExtractJobData>(DOCUMENT_EXTRACT.name, {
      connection: queueConnection,
      defaultJobOptions: DOCUMENT_EXTRACT.defaultJobOptions,
    });
    const workers: Worker[] = [];

    try {
      await startDocumentExtract(connection, pino({ level: 'silent' }), workers, []);
      await queue.add('document.extract', job, {
        jobId: [job.orgId, job.documentId, job.extractionId].join('--'),
      });

      const draft = await waitForDraft(extraction.id);
      expectContractDraft(draft);

      await expect(
        prisma.accountSolution.count({ where: { orgId: org.id, accountId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.accountProduct.count({ where: { orgId: org.id, accountId } }),
      ).resolves.toBe(0);
    } finally {
      await Promise.all(workers.map((worker) => worker.close()));
      await queue.close();
      await connection.quit();
      await queueConnection.quit();
      await cleanupContractFixture(org.id, accountId);
    }
  });
});
