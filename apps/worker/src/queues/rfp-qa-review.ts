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

import { RFP_QA_REVIEW, rolePreambleForKey } from '@bidstack/shared';
import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { getOrgDust, resolveAgentId } from '../lib/dust-credentials.js';
import { runRfpCompletion } from '../lib/rfp-llm.js';
import { coerceJsonObject } from '../lib/llm-provider.js';
import {
  markOrchestrationFailed,
  markOrchestrationAwaitingApproval,
} from './rfp-requirement-extract.helpers.js';

const QUEUE_NAME = RFP_QA_REVIEW.name;
const DEFAULT_QA_AGENT_ID = 'rfp-qa-agent';

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

  const { client: dust, creds } = await getOrgDust(orgId, log);
  const qaAgentId =
    resolveAgentId(creds, 'qaReview', process.env.DUST_RFP_QA_AGENT_ID) ?? DEFAULT_QA_AGENT_ID;
  let result: QaResult;

  if (proposal.compiledContent) {
    const userMessage = buildAgentUserMessage({
      template:
        `${rolePreambleForKey('qa_reviewer')}\n\n` +
        'Score this compiled proposal for quality, compliance, and completeness. ' +
        'Return ONLY JSON: { "scoreBps": 0-10000, "issues": [{ "severity": string, "description": string }] }.',
      trusted: { PROPOSAL_ID: proposalId },
      rfpContent: proposal.compiledContent.slice(0, MAX_PROPOSAL_CHARS),
    });

    // Provider-agnostic: direct LLM (RFP_LLM_PROVIDER) → Dust agent → zero-score fallback.
    const completion = await runRfpCompletion({
      orgId,
      log,
      dust,
      agentId: qaAgentId,
      userMessage,
      system:
        'You are an RFP QA reviewer. Respond with ONLY a valid JSON object — no prose, no markdown fences.',
      agentType: 'rfp-qa',
      responseFormat: 'json_object',
      traceId: job.id ?? undefined,
    });

    if (completion) {
      try {
        const p2 = QaResult.safeParse(JSON.parse(coerceJsonObject(completion.text)));
        result = p2.success ? p2.data : fallbackQa();
      } catch {
        result = fallbackQa();
      }
    } else {
      result = fallbackQa();
    }
  } else {
    // No compiled content to score — degrade gracefully.
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
      ).catch((markErr) =>
        log.warn({ err: markErr }, 'best-effort orchestration failure mark write failed'),
      );
    }
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-qa-review worker started');
}
