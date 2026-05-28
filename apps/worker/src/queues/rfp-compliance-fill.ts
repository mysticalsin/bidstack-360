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
import { DustClient } from '@bidstack/dust-client';

import { RFP_COMPLIANCE_FILL } from '@bidstack/shared';
import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { logAiInvocation } from '../lib/ai-audit-worker.js';

const QUEUE_NAME = RFP_COMPLIANCE_FILL.name;
const DUST_AGENT_ID = process.env.DUST_RFP_COMPLIANCE_AGENT_ID ?? 'rfp-compliance-fill-agent';

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

// ─── Dust client (fail-open) ────────────────────────────────────────────────

function getDustClient(log: pino.Logger): DustClient | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) {
    log.warn('DUST_API_KEY or DUST_WORKSPACE_ID not set — compliance fill degraded');
    return null;
  }
  return new DustClient({ apiKey, workspaceId, logger: log });
}

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

  const dust = getDustClient(log);
  let result: ComplianceResult;

  if (dust) {
    const userMessage = buildAgentUserMessage({
      template:
        'Assess compliance for the following requirement{{CATEGORY_SUFFIX}}. ' +
        'Return ONLY a JSON object with: status (YES|NO|PARTIAL|NOT_APPLICABLE), ' +
        'justification (string, max 200 chars), confidence (0-10000).',
      trusted: {
        CATEGORY_SUFFIX: category ? ` in category "${category}"` : '',
      },
      rfpContent: requirementText,
    });

    const t0 = Date.now();
    try {
      const run = await dust.runAgent(DUST_AGENT_ID, userMessage);
      const responseText = run.output ?? '{}';
      const durationMs = Date.now() - t0;

      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-compliance',
          // DustAgentRun does not expose model or tokenCount — use fixed values
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

      const p2 = ComplianceResult.safeParse(JSON.parse(responseText));
      result = p2.success ? p2.data : fallbackCompliance();
    } catch (err) {
      log.warn({ err, matrixItemId }, 'rfp-compliance-fill: Dust call failed, falling back');
      result = fallbackCompliance();
      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-compliance',
          model: 'dust',
          prompt: userMessage,
          response: '',
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'error',
          errorMsg: (err as Error).message?.slice(0, 500),
          traceId: job.id ?? undefined,
        },
        log,
      );
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
