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
import type { DustClient } from '@bidstack/dust-client';
// Use the sandboxed wrapper so untrusted upload bytes are parsed inside a
// worker_thread with a memory ceiling and a hard timeout, isolated from the
// queue worker's heap. See docs/audits/2026-05-24-twenty-agent-deep-audit.md
// HIGH-2 for the threat model.
import { extractTextFromBufferSandboxed } from '../lib/extract-text-sandbox.js';
import { readStoredDocument } from '../lib/storage-read.js';
import { extractContractFields } from '../lib/contract-extract-fields.js';
import { extractContractFieldsLLM } from '../lib/contract-extract-llm.js';
import { resolveLlmFromEnv } from '../lib/llm-provider.js';
import { resolveOrgLlm } from '../lib/org-llm.js';
import { getOrgDust, resolveAgentId } from '../lib/dust-credentials.js';
import type { ContractExtractionDraft } from '@bidstack/shared';

import { deterministicExtract, normalizeWinLoss } from './document-extract-analysis.js';
import { writeBidWorkspaceArtifacts } from './document-extract-db.js';
import type { ExtractionResult, WinLossSignal } from './document-extract-types.js';

const QUEUE_NAME = DOCUMENT_EXTRACT.name;

// ─── Prompt builder ────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a CRM intelligence extractor. Given the following company document, extract:
1. SOLUTIONS — services, offerings, consulting engagements, or strategic capabilities this company provides.
2. PRODUCTS — software, platforms, hardware, or tangible items this company sells.
3. WINLOSS — if the document is a bid debrief, outcome note, or email that reveals whether a deal was WON or LOST and why.

Respond ONLY in valid JSON with this exact shape (no markdown, no explanation):
{
  "solutions": [
    { "name": "...", "description": "...", "category": "..." }
  ],
  "products": [
    { "name": "...", "description": "...", "category": "...", "priceRange": "optional string like 50000-150000" }
  ],
  "winLoss": {
    "outcome": "won | lost | unknown",
    "reasons": ["one or more of: price, product_fit, relationship, timing, support, competitor"],
    "competitors": ["named competitor companies, if any"],
    "summary": "one short sentence on why we won or lost, or null"
  }
}

If no solutions or products are found, return empty arrays. Categories should be one of: infrastructure, security, data, ai, software, network, general. If the document shows no win/loss signal, set "winLoss" to null.

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
  // 'contract' routes to the MSA/rate-card extractor and parks a reviewable
  // draft on the DocumentExtraction instead of upserting solutions/products.
  extractionKind: z.enum(['intel', 'contract']).optional(),
});
type JobData = z.infer<typeof JobData>;
export type DocumentExtractJobData = JobData;

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
    winLoss?: {
      outcome?: string;
      reasons?: unknown;
      competitors?: unknown;
      summary?: string | null;
    } | null;
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
    winLoss: normalizeWinLoss(parsed.winLoss),
  };

  log.info(
    { runId: run.run_id, solutions: result.solutions.length, products: result.products.length },
    'Dust extraction completed',
  );

  return { result, runId: run.run_id };
}

// Prefer the LLM draft, but backfill any field it left null from the
// deterministic regex pass — best of both. The LLM warnings (incl. the review
// reminder) carry through; confidence stays the LLM's higher value.
function mergeContractDrafts(
  llm: ContractExtractionDraft,
  det: ContractExtractionDraft,
): ContractExtractionDraft {
  const pick = <T>(a: T | null, b: T | null): T | null => (a !== null ? a : b);
  return {
    reference: pick(llm.reference, det.reference),
    kind: pick(llm.kind, det.kind),
    countries: llm.countries.length ? llm.countries : det.countries,
    currency: pick(llm.currency, det.currency),
    globalRebateBps: pick(llm.globalRebateBps, det.globalRebateBps),
    effectiveDate: pick(llm.effectiveDate, det.effectiveDate),
    expiryDate: pick(llm.expiryDate, det.expiryDate),
    rateReviewSchedule: pick(llm.rateReviewSchedule, det.rateReviewSchedule),
    rateCard: llm.rateCard.length ? llm.rateCard : det.rateCard,
    confidenceBps: llm.confidenceBps,
    warnings: llm.warnings,
  };
}

function accountIntelExtractionMetadata(input: {
  extractionId: string;
  documentId: string;
  dustRunId: string | null;
}): Prisma.InputJsonValue {
  return {
    source: {
      type: 'document_extraction',
      extractionId: input.extractionId,
      documentId: input.documentId,
      extractor: input.dustRunId ? 'dust' : 'deterministic',
      dustRunId: input.dustRunId,
    },
  };
}

// ─── Worker processor ──────────────────────────────────────────────────────

async function processJobData(
  rawData: unknown,
  log: pino.Logger,
  jobId: string | number | undefined,
): Promise<void> {
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
    extractionKind,
  } = JobData.parse(rawData);

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

  // Contract lane: extract MSA/rate-card fields and park a reviewable draft on
  // the extraction row (the user confirms before a ContractAgreement is created).
  // No solutions/products writeback. The deterministic extractor is the
  // always-available baseline; when the org has an active LLM provider (Settings)
  // or a deployment env provider is set, an LLM refinement pass produces a
  // higher-confidence draft over the same OCR'd text.
  if (extractionKind === 'contract') {
    const deterministic = extractContractFields(text);
    let draft = deterministic;
    let source: 'deterministic' | 'llm' = 'deterministic';

    const llm = (await resolveOrgLlm(orgId)) ?? resolveLlmFromEnv();
    if (llm) {
      const llmDraft = await extractContractFieldsLLM(text, llm);
      if (llmDraft) {
        draft = mergeContractDrafts(llmDraft, deterministic);
        source = 'llm';
      } else {
        log.warn({ jobId, provider: llm.kind }, 'contract LLM pass failed; using deterministic');
      }
    }

    const done = await prisma.documentExtraction.updateMany({
      where: { id: extractionId, orgId, documentId, deletedAt: null },
      data: {
        status: 'done',
        extractedData: draft as unknown as Prisma.InputJsonValue,
      },
    });
    if (done.count !== 1) {
      throw new Error('Contract extraction does not match an active tenant-scoped extraction');
    }
    log.info(
      { jobId, documentId, source, provider: llm?.kind ?? null },
      'contract extraction completed',
    );
    return;
  }

  let result: ExtractionResult;
  let dustRunId: string | null = null;

  const { client: dust, creds } = await getOrgDust(orgId, log);
  const agentId =
    resolveAgentId(creds, 'documentExtract', process.env.DUST_DOCUMENT_EXTRACT_AGENT_ID) ?? null;

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
  const extractionMetadata = accountIntelExtractionMetadata({
    extractionId,
    documentId,
    dustRunId,
  });

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
        metadata: extractionMetadata,
      },
      update: {
        description: s.description || null,
        category: s.category,
        extractedFromDocumentId: documentId,
        confidenceBps: dustRunId ? 8500 : 5200,
        metadata: extractionMetadata,
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
        metadata: extractionMetadata,
      },
      update: {
        description: p.description || null,
        category: p.category,
        extractedFromDocumentId: documentId,
        confidenceBps: dustRunId ? 8500 : 5200,
        metadata: extractionMetadata,
      },
    });
  }

  // Mark extraction done. winLoss is stored on the extraction's JSON so the
  // account intel panel can surface "why we won/lost" with document provenance
  // (no schema change); a later phase rolls it up into WinLossRecord.
  const extractedData: {
    solutions: Array<{ name: string; description: string; category: string }>;
    products: Array<{ name: string; description: string; category: string; priceRange?: string }>;
    winLoss?: WinLossSignal | null;
  } = { solutions: result.solutions, products: result.products, winLoss: result.winLoss ?? null };

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

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  await processJobData(job.data, log, job.id);
}

export async function processDocumentExtractJobForTest(
  data: DocumentExtractJobData,
  log: pino.Logger,
): Promise<void> {
  await processJobData(data, log, 'test-direct');
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startDocumentExtract(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): Promise<void> {
  // Env-tunable so prod can scale extraction throughput without a code change
  // (defaults preserve prior behaviour). NB: this is a global cap — true per-org
  // fairness (a bulk import by one tenant must not starve others) needs a
  // groupKey/per-org lane and is tracked as follow-up; auto-extract jobs are
  // enqueued at lower priority (see api enqueueDocumentExtract) so user-initiated
  // extracts still jump the queue.
  const concurrency = Math.max(1, parseInt(process.env.DOCUMENT_EXTRACT_CONCURRENCY ?? '2', 10) || 2);
  const limiterMax = Math.max(1, parseInt(process.env.DOCUMENT_EXTRACT_RATE_MAX ?? '10', 10) || 10);
  const queue = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id })),
    {
      connection,
      concurrency,
      limiter: { max: limiterMax, duration: 60_000 },
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
      .catch((updateErr) =>
        log.warn({ err: updateErr }, 'best-effort documentExtraction status write failed'),
      );
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
        .catch((updateErr) =>
          log.warn({ err: updateErr }, 'best-effort documentVersion failure status write failed'),
        );
      prisma.bidDocument
        .updateMany({
          where: { id: parsed.data.bidDocumentId, orgId, deletedAt: null },
          data: { status: 'failed' },
        })
        .catch((updateErr) =>
          log.warn({ err: updateErr }, 'best-effort bidDocument failure status write failed'),
        );
    }
  });

  workers.push(queue);
  log.info({ queue: QUEUE_NAME }, 'document extraction worker started');
}
