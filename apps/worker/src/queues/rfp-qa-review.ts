// RFP QA review worker.
//
// FINAL automated stage of the RFP pipeline. Calls Dust rfp-qa-agent to
// score the compiled proposal for quality, compliance, and completeness.
// Writes scoreBps + issues to the Proposal record, then transitions the
// orchestration to awaiting_approval — the human approval gate takes over.
//
// WHY fail-open: a missing Dust agent or network failure must not block the
// proposal from reaching a human reviewer. The fallback score (0) signals
// to the approval UI that manual QA is required.
//
// WHY concurrency 2: RFP_QA_REVIEW allows only 2 attempts (see queue-config).
// The human gate immediately follows; a high concurrency would only risk
// duplicate writes to the same proposal on transient retries.
//
// WHY no next-stage enqueue: this is the terminal automation step.
// markOrchestrationAwaitingApproval sets the state; the human routes
// approve or reject from there.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker } from 'bullmq';
import { z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { DustClient } from '@bidstack/dust-client';

import { RFP_QA_REVIEW } from '@bidstack/shared';
import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { logAiInvocation } from '../lib/ai-audit-worker.js';
import {
  markOrchestrationFailed,
  markOrchestrationAwaitingApproval,
} from './rfp-requirement-extract.helpers.js';

const QUEUE_NAME = RFP_QA_REVIEW.name;
const DUST_AGENT_ID = process.env.DUST_RFP_QA_AGENT_ID ?? 'rfp-qa-agent';

// Proposal content sent to Dust is capped to avoid token budget spikes.
// WHY 12 000 chars: empirically covers ~3 000-word proposals within Dust limits.
const MAX_PROPOSAL_CHARS = 12_000;

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  proposalId: z.string().uuid(),
});
type JobData = z.infer<typeof JobData>;

// ─── Dust response schema ──────────────────────────────────────────────────

const QaResult = z.object({
  scoreBps: z.number().int().min(0).max(10000),
  issues: z.array(
    z.object({
      severity: z.string(),
      description: z.string(),
    }),
  ),
});
type QaResult = z.infer<typeof QaResult>;

// ─── Deterministic fallback ─────────────────────────────────────────────────

function fallbackQa(): QaResult {
  return {
    scoreBps: 0,
    issues: [
      { severity: 'unknown', description: 'QA review unavailable — manual review required.' },
    ],
  };
}

// ─── Dust client (fail-open) ────────────────────────────────────────────────

function getDustClient(log: pino.Logger): DustClient | null {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) {
    log.warn('DUST_API_KEY or DUST_WORKSPACE_ID not set — QA review degraded to fallback score');
    return null;
  }
  return new DustClient({ apiKey, workspaceId, logger: log });
}

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(job: Job<JobData>, log: pino.Logger): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`rfp-qa-review: invalid job data: ${parsed.error.message}`);
  }

  const { orgId, orchestrationId, proposalId } = parsed.data;

  // Load the compiled proposal — must exist before QA can run.
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId, orgId },
    select: { id: true, compiledContent: true },
  });
  if (!proposal) {
    const err = new Error(`rfp-qa-review: proposal ${proposalId} not found for org ${orgId}`);
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  const dust = getDustClient(log);
  let result: QaResult;

  if (dust && proposal.compiledContent) {
    const userMessage = buildAgentUserMessage({
      template:
        'Score this compiled proposal for quality, compliance, and completeness. ' +
        'Return ONLY JSON: { "scoreBps": 0-10000, "issues": [{ "severity": string, "description": string }] }.',
      trusted: { PROPOSAL_ID: proposalId },
      rfpContent: proposal.compiledContent.slice(0, MAX_PROPOSAL_CHARS),
    });

    const t0 = Date.now();
    try {
      const run = await dust.runAgent(DUST_AGENT_ID, userMessage);
      const responseText = run.output ?? '{}';
      const durationMs = Date.now() - t0;

      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-qa',
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

      const p2 = QaResult.safeParse(JSON.parse(responseText));
      result = p2.success ? p2.data : fallbackQa();
    } catch (err) {
      log.warn({ err, proposalId }, 'rfp-qa-review: Dust call failed, falling back to zero score');
      result = fallbackQa();
      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-qa',
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
    // No Dust client or no compiled content — degrade gracefully.
    result = fallbackQa();
  }

  // Persist QA score + issues to the Proposal record.
  // WHY qaIssues as Prisma.InputJsonValue: Prisma Json fields require this cast
  // to accept arbitrary objects; the runtime value is a plain JS array.
  await prisma.proposal.update({
    where: { id: proposalId, orgId },
    data: {
      qaScoreBps: result.scoreBps,
      qaReviewedAt: new Date(),
      qaIssues: result.issues as unknown as Prisma.InputJsonValue,
    },
  });

  // Terminal step — advance orchestration to the human approval gate.
  // Does NOT enqueue a next stage; ApprovalGate UI drives the next transition.
  await markOrchestrationAwaitingApproval(orchestrationId, orgId);

  log.info(
    {
      orgId,
      orchestrationId,
      proposalId,
      scoreBps: result.scoreBps,
      issueCount: result.issues.length,
    },
    'rfp-qa-review: complete',
  );
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpQaReview(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): Promise<void> {
  // WHY concurrency 2: QA_REVIEW allows only 2 attempts (queue-config);
  // human approval gate immediately follows — no further fan-out.
  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id })),
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, proposalId: job.data.proposalId }, 'rfp-qa-review: completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-qa-review: failed');

    const parsed = JobData.safeParse(job?.data);
    if (parsed.success) {
      const { orchestrationId, orgId } = parsed.data;
      markOrchestrationFailed(
        orchestrationId,
        orgId,
        'qa_review',
        (err as Error).message?.slice(0, 2000) ?? 'unknown',
      ).catch(() => undefined);
    }
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-qa-review worker started');
}
