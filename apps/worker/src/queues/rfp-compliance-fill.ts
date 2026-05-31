// RFP compliance fill worker.
//
// Calls Dust rfp-compliance-fill-agent to assess a single compliance matrix
// row — determines YES/NO/PARTIAL compliance and generates a one-line
// justification. Writes result to ComplianceMatrixRow.
//
// WHY per-row: compliance matrices can have 200+ rows. Parallelism
// (concurrency 6) gives a ~35× speedup over serial processing while
// staying within Dust API rate limits.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';

import { RFP_COMPLIANCE_FILL, rolePreambleForKey } from '@bidstack/shared';
import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { getOrgDust, resolveAgentId } from '../lib/dust-credentials.js';
import { runRfpCompletion } from '../lib/rfp-llm.js';
import { coerceJsonObject } from '../lib/llm-provider.js';

const QUEUE_NAME = RFP_COMPLIANCE_FILL.name;
const DEFAULT_COMPLIANCE_AGENT_ID = 'rfp-compliance-fill-agent';

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  matrixItemId: z.string().uuid(),
  requirementText: z.string().min(1),
  category: z.string().optional(),
});
type JobData = z.infer<typeof JobData>;

// ─── Dust response schema ──────────────────────────────────────────────────

const ComplianceResult = z.object({
  status: z.enum(['YES', 'NO', 'PARTIAL', 'NOT_APPLICABLE']),
  justification: z.string().max(1000),
  confidence: z.number().int().min(0).max(10000).optional(),
});
type ComplianceResult = z.infer<typeof ComplianceResult>;

// ─── Deterministic fallback ─────────────────────────────────────────────────

function fallbackCompliance(): ComplianceResult {
  return {
    status: 'PARTIAL',
    justification: 'AI assessment unavailable. Please complete manually.',
    confidence: 0,
  };
}

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, orchestrationId, matrixItemId, requirementText, category } = parsed.data;

  // Verify compliance row belongs to this org — uses existing ComplianceMatrixRow model
  const item = await prisma.complianceMatrixRow.findUnique({
    where: { id: matrixItemId },
    select: { id: true, orgId: true },
  });
  if (!item || item.orgId !== orgId) {
    const err = new Error(
      `rfp-compliance-fill: matrixItem ${matrixItemId} not found for org ${orgId}`,
    );
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  const { client: dust, creds } = await getOrgDust(orgId, log);
  const complianceAgentId =
    resolveAgentId(creds, 'complianceFill', process.env.DUST_RFP_COMPLIANCE_AGENT_ID) ??
    DEFAULT_COMPLIANCE_AGENT_ID;
  let result: ComplianceResult;

  const userMessage = buildAgentUserMessage({
    template:
      `${rolePreambleForKey('compliance_officer')}\n\n` +
      'Assess compliance for the following requirement{{CATEGORY_SUFFIX}}. ' +
      'Return ONLY a JSON object with: status (YES|NO|PARTIAL|NOT_APPLICABLE), ' +
      'justification (string, max 200 chars), confidence (0-10000).',
    trusted: {
      CATEGORY_SUFFIX: category ? ` in category "${category}"` : '',
    },
    rfpContent: requirementText,
  });

  // Provider-agnostic: direct LLM (RFP_LLM_PROVIDER) → Dust agent → PARTIAL fallback.
  const completion = await runRfpCompletion({
    orgId,
    log,
    dust,
    agentId: complianceAgentId,
    userMessage,
    system:
      'You are an RFP compliance officer. Respond with ONLY a valid JSON object — no prose, no markdown fences.',
    agentType: 'rfp-compliance',
    traceId: job.id ?? undefined,
  });

  if (completion) {
    try {
      const p2 = ComplianceResult.safeParse(JSON.parse(coerceJsonObject(completion.text)));
      result = p2.success ? p2.data : fallbackCompliance();
    } catch {
      result = fallbackCompliance();
    }
  } else {
    result = fallbackCompliance();
  }

  // WHY responseStatus + answerDraft: ComplianceMatrixRow schema does not have
  // a justification, dustRunId, or assessedAt column. responseStatus holds the
  // compliance verdict; answerDraft holds the AI-generated justification text.
  await prisma.complianceMatrixRow.update({
    where: { id: matrixItemId },
    data: {
      responseStatus: result.status,
      answerDraft: result.justification,
    },
  });

  log.info(
    { orgId, orchestrationId, matrixItemId, status: result.status },
    'rfp-compliance-fill: complete',
  );
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpComplianceFill(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): Promise<void> {
  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id })),
    {
      connection,
      concurrency: 6,
      limiter: { max: 30, duration: 60_000 },
    },
  );

  worker.on('completed', (job) => {
    log.info(
      { jobId: job.id, matrixItemId: job.data.matrixItemId },
      'rfp-compliance-fill: completed',
    );
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-compliance-fill: failed');
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-compliance-fill worker started');
}
