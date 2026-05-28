// RFP requirement extraction worker.
//
// Calls Dust rfp-extractor-agent on the raw document text, parses the
// structured requirements JSON response, and writes Requirement rows.
// After extraction, enqueues one rfp.embed-requirement job per requirement.
//
// WHY raw SQL for RfpOrchestration updates: Wave 9 schema — Prisma client
// hasn't been regenerated yet due to Windows DLL lock. All values parameterized.
//
// Requirements are written via prisma.requirement (existing Wave 1 model)
// linked by documentVersionId. orchestrationId is stored in metadata JSON.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker, Queue as BullQueue } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { DustClient } from '@bidstack/dust-client';

import { RFP_REQUIREMENT_EXTRACT, RFP_EMBED_REQUIREMENT } from '@bidstack/shared';
import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { logAiInvocation } from '../lib/ai-audit-worker.js';

const QUEUE_NAME = RFP_REQUIREMENT_EXTRACT.name;
const EMBED_QUEUE_NAME = RFP_EMBED_REQUIREMENT.name;

const DUST_AGENT_ID = process.env.DUST_RFP_EXTRACTOR_AGENT_ID ?? 'rfp-extractor-agent';

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  rfpRequestId: z.string().min(1),
  documentVersionId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  chunkIndex: z.number().int().min(0).default(0),
  totalChunks: z.number().int().min(1).default(1),
});
type JobData = z.infer<typeof JobData>;

// ─── Extracted requirement schema from Dust response ───────────────────────

const ExtractedRequirement = z.object({
  externalRef: z.string(),
  text: z.string().min(1),
  requirementType: z.string().default('functional'),
  mandatory: z.boolean().default(true),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  confidenceBps: z.number().int().min(0).max(10000).default(7000),
  sourceChunkIndex: z.number().int().min(0).default(0),
});

const DustExtractionResponse = z.object({
  requirements: z.array(ExtractedRequirement),
});

// ─── Dust client (fail-open) ────────────────────────────────────────────────

function getDustClient(log: pino.Logger): DustClient | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) {
    log.warn('DUST_API_KEY or DUST_WORKSPACE_ID not set — rfp extraction degraded to empty result');
    return null;
  }
  return new DustClient({ apiKey, workspaceId, logger: log });
}

// ─── Deterministic fallback ─────────────────────────────────────────────────

function fallbackExtract(rawText: string): Array<z.infer<typeof ExtractedRequirement>> {
  const lines = rawText.split('\n').filter((l) => l.trim().length > 20);
  const reqPatterns = /^\s*(shall|must|should|required|the system|the vendor|bidder)/i;
  return lines
    .filter((l) => reqPatterns.test(l))
    .slice(0, 50)
    .map((text, i) => ({
      externalRef: `REQ-${String(i + 1).padStart(4, '0')}`,
      text: text.trim().slice(0, 2000),
      requirementType: 'functional',
      mandatory: true,
      priority: 'medium' as const,
      confidenceBps: 4000,
      sourceChunkIndex: 0,
    }));
}

// ─── Orchestration state helpers (raw SQL) ─────────────────────────────────

async function updateOrchestrationPhase(
  orchestrationId: string,
  orgId: string,
  phase: string,
  completedPhase: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE rfp_orchestrations
    SET
      current_phase    = ${phase},
      completed_phases = array_append(completed_phases, ${completedPhase}::text),
      updated_at       = now()
    WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
  `;
}

async function markOrchestrationFailed(
  orchestrationId: string,
  orgId: string,
  phase: string,
  reason: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE rfp_orchestrations
    SET state = 'failed', failed_phase = ${phase}, failure_reason = ${reason}, updated_at = now()
    WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
  `;
}

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(
  job: Job<JobData>,
  log: pino.Logger,
  embedQueue: BullQueue,
): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, documentVersionId, orchestrationId, chunkIndex, totalChunks } = parsed.data;

  // Load document text — DocumentVersion is a Wave 1 model, safe to use Prisma client
  const docVersion = await prisma.documentVersion.findUnique({
    where: { id: documentVersionId, orgId },
    select: { extractedText: true },
  });
  if (!docVersion?.extractedText) {
    throw new Error(`DocumentVersion ${documentVersionId} has no extractedText — cannot extract`);
  }

  const rawText = docVersion.extractedText;
  const dust = getDustClient(log);

  let requirements: Array<z.infer<typeof ExtractedRequirement>>;
  let dustRunId: string | null = null;

  // ─── Call Dust rfp-extractor-agent ───────────────────────────────────
  if (dust) {
    const userMessage = buildAgentUserMessage({
      template:
        'Extract all requirements from the following RFP document chunk ' +
        '(chunk {{CHUNK_INDEX}} of {{TOTAL_CHUNKS}}). ' +
        'Return ONLY a JSON object with a "requirements" array. Each item must have: ' +
        'externalRef (string), text (string), requirementType (string), mandatory (boolean), ' +
        'priority (low|medium|high|critical), confidenceBps (0-10000), sourceChunkIndex (integer).',
      trusted: { CHUNK_INDEX: chunkIndex + 1, TOTAL_CHUNKS: totalChunks },
      rfpContent: rawText,
    });

    const t0 = Date.now();
    try {
      const run = await dust.runAgent(DUST_AGENT_ID, userMessage);
      dustRunId = run.run_id;
      const durationMs = Date.now() - t0;
      const responseText = run.output ?? '{}';

      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-extractor',
          model: 'dust',
          prompt: userMessage,
          response: responseText,
          tokenCount: 0,
          durationMs,
          status: 'success',
          traceId: job.id ?? undefined,
        },
        log,
      );

      const p2 = DustExtractionResponse.safeParse(JSON.parse(responseText));
      requirements = p2.success ? p2.data.requirements : fallbackExtract(rawText);
    } catch (dustErr) {
      log.warn({ err: dustErr }, 'rfp-requirement-extract: Dust call failed, falling back');
      requirements = fallbackExtract(rawText);
      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-extractor',
          model: 'dust',
          prompt: userMessage,
          response: '',
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'error',
          errorMsg: (dustErr as Error).message?.slice(0, 500),
          traceId: job.id ?? undefined,
        },
        log,
      );
    }
  } else {
    requirements = fallbackExtract(rawText);
  }

  if (requirements.length === 0) {
    log.info({ orgId, orchestrationId }, 'rfp-requirement-extract: no requirements found');
    await updateOrchestrationPhase(orchestrationId, orgId, 'story_match', 'requirement_extract');
    return;
  }

  // ─── Persist requirements via existing Requirement model ───────────────
  // WHY createMany with skipDuplicates: re-runs are idempotent;
  // externalRef+documentVersionId is a natural dedup key.
  // orchestrationId stored in metadata JSON since the Requirement model
  // predates Wave 9 and has no orchestrationId column.
  await prisma.requirement.createMany({
    data: requirements.map((r) => ({
      orgId,
      documentVersionId,
      externalRef: r.externalRef,
      text: r.text,
      requirementType: r.requirementType,
      mandatory: r.mandatory,
      priority: r.priority as 'low' | 'medium' | 'high' | 'critical',
      confidenceBps: r.confidenceBps,
      metadata: { orchestrationId, sourceChunkIndex: r.sourceChunkIndex, dustRunId },
    })),
    skipDuplicates: true,
  });

  // ─── Fan-out: one embed-requirement job per extracted requirement ──────
  const savedRequirements = await prisma.requirement.findMany({
    where: { documentVersionId, orgId, deletedAt: null },
    select: { id: true, text: true },
  });

  for (const req of savedRequirements) {
    await embedQueue.add(
      'rfp.embed-requirement',
      {
        orgId,
        orchestrationId,
        requirementId: req.id,
        contentText: req.text,
      },
      { jobId: `rfp-embed-req:${orgId}:${req.id}` },
    );
  }

  await updateOrchestrationPhase(orchestrationId, orgId, 'story_match', 'requirement_extract');

  log.info(
    { orgId, orchestrationId, count: savedRequirements.length },
    'rfp-requirement-extract: complete',
  );
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpRequirementExtract(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const embedQueue = new BullQueue(EMBED_QUEUE_NAME, {
    connection,
    defaultJobOptions: RFP_EMBED_REQUIREMENT.defaultJobOptions,
  });
  queues.push(embedQueue);

  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id }), embedQueue),
    {
      connection,
      concurrency: 2,
      limiter: { max: 20, duration: 60_000 },
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, orgId: job.data.orgId }, 'rfp-requirement-extract: completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-requirement-extract: failed');
    if (!job) return;
    const p = JobData.safeParse(job.data);
    if (!p.success) return;
    markOrchestrationFailed(
      p.data.orchestrationId,
      p.data.orgId,
      'requirement_extract',
      err.message.slice(0, 2000),
    ).catch(() => undefined);
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-requirement-extract worker started');
}
