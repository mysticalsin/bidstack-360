// Document intelligence extraction worker — BullMQ bootstrap + job processor.
//
// Reads the source object from storage, performs parser/OCR work off the API
// request path, calls a Dust agent if configured, and writes structured
// solutions/products back to the CRM database.
//
// Deterministic extraction logic:  document-extract-analysis.ts
// Bid-workspace DB writes:          document-extract-db.ts
// Shared types and constants:       document-extract-types.ts

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker } from 'bullmq';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';

import { DOCUMENT_EXTRACT } from '@bidstack/shared';
import { DustClient } from '@bidstack/dust-client';
// Use the sandboxed wrapper so untrusted upload bytes are parsed inside a
// worker_thread with a memory ceiling and a hard timeout, isolated from the
// queue worker's heap. See docs/audits/2026-05-24-twenty-agent-deep-audit.md
// HIGH-2 for the threat model.
import { extractTextFromBufferSandboxed } from '../lib/extract-text-sandbox.js';
import { readStoredDocument } from '../lib/storage-read.js';

import { deterministicExtract } from './document-extract-analysis.js';
import { writeBidWorkspaceArtifacts } from './document-extract-db.js';
import type { ExtractionResult } from './document-extract-types.js';

const QUEUE_NAME = DOCUMENT_EXTRACT.name;

// ─── Dust client (lazy, fail-open) ─────────────────────────────────────────

function getDustClient(log: pino.Logger): DustClient | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) return null;
  return new DustClient({ apiKey, workspaceId, logger: log });
}

function getDustAgentId(): string | null {
  return process.env.DUST_DOCUMENT_EXTRACT_AGENT_ID ?? null;
}

// ─── Prompt builder ────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a CRM intelligence extractor. Given the following company document, extract:
1. SOLUTIONS — services, offerings, consulting engagements, or strategic capabilities this company provides.
2. PRODUCTS — software, platforms, hardware, or tangible items this company sells.

Respond ONLY in valid JSON with this exact shape (no markdown, no explanation):
{
  "solutions": [
    { "name": "...", "description": "...", "category": "..." }
  ],
  "products": [
    { "name": "...", "description": "...", "category": "...", "priceRange": "optional string like 50000-150000" }
  ]
}

If no solutions or products are found, return empty arrays. Categories should be one of: infrastructure, security, data, ai, software, network, general.

--- DOCUMENT ---
`;

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  accountId: z.string().min(1),
  documentId: z.string().uuid(),
  extractionId: z.string().uuid(),
  storageKey: z.string().min(1),
  contentType: z.string().min(1),
  name: z.string().min(1),
  opportunityId: z.string().uuid().optional(),
  bidDocumentId: z.string().uuid().optional(),
  documentVersionId: z.string().uuid().optional(),
  prompt: z.string().optional(),
});
type JobData = z.infer<typeof JobData>;

// ─── Dust extraction ───────────────────────────────────────────────────────

async function runDustExtraction(
  dust: DustClient,
  agentId: string,
  text: string,
  prompt: string | undefined,
  log: pino.Logger,
): Promise<{ result: ExtractionResult; runId: string }> {
  const message = prompt
    ? `${EXTRACTION_PROMPT}\nAdditional instructions: ${prompt}\n\n${text.slice(0, 80_000)}`
    : `${EXTRACTION_PROMPT}\n${text.slice(0, 80_000)}`;
  const run = await dust.runAgent(agentId, message);

  if (run.status === 'failed' || !run.output) {
    throw new Error(`Dust agent run failed: ${run.status}`);
  }

  let output = run.output;
  const fenceMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) output = fenceMatch[1];
  output = output.trim();

  const parsed = JSON.parse(output) as {
    solutions?: Array<{ name?: string; description?: string; category?: string }>;
    products?: Array<{
      name?: string;
      description?: string;
      category?: string;
      priceRange?: string;
    }>;
  };

  const result: ExtractionResult = {
    solutions: (parsed.solutions ?? [])
      .filter((s) => s.name)
      .map((s) => ({
        name: String(s.name).slice(0, 200),
        description: String(s.description ?? '').slice(0, 1000),
        category: String(s.category ?? 'general'),
      })),
    products: (parsed.products ?? [])
      .filter((p) => p.name)
      .map((p) => ({
        name: String(p.name).slice(0, 200),
        description: String(p.description ?? '').slice(0, 1000),
        category: String(p.category ?? 'general'),
        priceRange: p.priceRange,
      })),
  };

  log.info(
    { runId: run.run_id, solutions: result.solutions.length, products: result.products.length },
    'Dust extraction completed',
  );

  return { result, runId: run.run_id };
}

// ─── Worker processor ──────────────────────────────────────────────────────

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  const {
    orgId,
    accountId,
    documentId,
    extractionId,
    storageKey,
    contentType,
    name,
    opportunityId,
    bidDocumentId,
    documentVersionId,
    prompt,
  } = JobData.parse(job.data);

  // Mark as running
  const runningUpdate = await prisma.documentExtraction.updateMany({
    where: { id: extractionId, orgId, documentId, deletedAt: null },
    data: { status: 'running' },
  });
  if (runningUpdate.count !== 1) {
    throw new Error('Document extraction job does not match an active tenant-scoped extraction');
  }
  if (bidDocumentId && documentVersionId) {
    await prisma.documentVersion.updateMany({
      where: { id: documentVersionId, orgId, bidDocumentId, deletedAt: null },
      data: { extractionStatus: 'running', ocrStatus: 'running' },
    });
    await prisma.bidDocument.updateMany({
      where: { id: bidDocumentId, orgId, deletedAt: null },
      data: { status: 'extracting' },
    });
  }

  const stored = await readStoredDocument({ orgId, storageKey });
  const extractedText = await extractTextFromBufferSandboxed({
    buffer: stored.buffer,
    contentType,
    name,
    sourcePath: stored.sourcePath,
  });
  const text = extractedText.length > 100_000 ? extractedText.slice(0, 100_000) : extractedText;

  let result: ExtractionResult;
  let dustRunId: string | null = null;

  const dust = getDustClient(log);
  const agentId = getDustAgentId();

  if (dust && agentId) {
    try {
      const extracted = await runDustExtraction(dust, agentId, text, prompt, log);
      result = extracted.result;
      dustRunId = extracted.runId;
    } catch (err) {
      log.warn({ err }, 'Dust extraction failed, falling back to deterministic extraction');
      result = deterministicExtract(text);
    }
  } else {
    log.info('No Dust agent configured, using deterministic extraction');
    result = deterministicExtract(text);
  }

  // Persist solutions
  for (const s of result.solutions) {
    await prisma.accountSolution.upsert({
      where: { orgId_accountId_name: { orgId, accountId, name: s.name } },
      create: {
        orgId,
        accountId,
        name: s.name,
        description: s.description || null,
        category: s.category,
        extractedFromDocumentId: documentId,
        confidenceBps: dustRunId ? 8500 : 5200,
      },
      update: {
        description: s.description || null,
        category: s.category,
        extractedFromDocumentId: documentId,
        confidenceBps: dustRunId ? 8500 : 5200,
      },
    });
  }

  // Persist products
  for (const p of result.products) {
    await prisma.accountProduct.upsert({
      where: { orgId_accountId_name: { orgId, accountId, name: p.name } },
      create: {
        orgId,
        accountId,
        name: p.name,
        description: p.description || null,
        category: p.category,
        extractedFromDocumentId: documentId,
        confidenceBps: dustRunId ? 8500 : 5200,
      },
      update: {
        description: p.description || null,
        category: p.category,
        extractedFromDocumentId: documentId,
        confidenceBps: dustRunId ? 8500 : 5200,
      },
    });
  }

  // Mark extraction done
  const extractedData: {
    solutions: Array<{ name: string; description: string; category: string }>;
    products: Array<{ name: string; description: string; category: string; priceRange?: string }>;
  } = { solutions: result.solutions, products: result.products };

  const doneUpdate = await prisma.documentExtraction.updateMany({
    where: { id: extractionId, orgId, documentId, deletedAt: null },
    data: {
      status: 'done',
      extractedData: extractedData as unknown as Prisma.InputJsonValue,
      dustRunId,
    },
  });
  if (doneUpdate.count !== 1) {
    throw new Error(
      'Document extraction completion did not match an active tenant-scoped extraction',
    );
  }

  if (bidDocumentId && documentVersionId && opportunityId) {
    await writeBidWorkspaceArtifacts({
      orgId,
      opportunityId,
      bidDocumentId,
      documentVersionId,
      text,
      dustRunId,
    });
  }
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startDocumentExtract(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): Promise<void> {
  const queue = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id })),
    {
      connection,
      concurrency: 2,
      limiter: { max: 10, duration: 60_000 },
    },
  );

  queue.on('completed', (job) => {
    log.info({ jobId: job.id, documentId: job.data.documentId }, 'document extraction completed');
  });

  queue.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'document extraction failed');
    if (!job) return;
    const parsed = JobData.safeParse(job.data);
    if (!parsed.success) {
      log.error(
        { jobId: job.id, err: parsed.error },
        'failed to parse job data in failure handler',
      );
      return;
    }
    const { orgId, documentId, extractionId } = parsed.data;
    prisma.documentExtraction
      .updateMany({
        where: { id: extractionId, orgId, documentId, deletedAt: null },
        data: { status: 'error', error: err.message.slice(0, 2000) },
      })
      .catch(() => undefined);
    if (parsed.data.bidDocumentId && parsed.data.documentVersionId) {
      prisma.documentVersion
        .updateMany({
          where: {
            id: parsed.data.documentVersionId,
            orgId,
            bidDocumentId: parsed.data.bidDocumentId,
            deletedAt: null,
          },
          data: {
            extractionStatus: 'failed',
            ocrStatus: 'failed',
            metadata: { error: err.message.slice(0, 2000) },
          },
        })
        .catch(() => undefined);
      prisma.bidDocument
        .updateMany({
          where: { id: parsed.data.bidDocumentId, orgId, deletedAt: null },
          data: { status: 'failed' },
        })
        .catch(() => undefined);
    }
  });

  workers.push(queue);
  log.info({ queue: QUEUE_NAME }, 'document extraction worker started');
}
