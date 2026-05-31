// RFP legal scan worker.
//
// Calls Dust rfp-legal-scan-agent over the assembled proposal sections.
// Logs findings to the AI audit log (EU AI Act Art. 50 transparency).
// Advances the orchestration to proposal_compile and chains the compile job.
//
// WHY sequential (not per-section): legal scan requires the full draft in
// context — individual section scans would miss cross-section risk patterns.
//
// FAIL-OPEN: if DUST_API_KEY / DUST_WORKSPACE_ID are absent the worker writes
// a "[Legal scan skipped — configure DUST_API_KEY.]" placeholder and
// continues. Pipeline is never blocked by a missing Dust credential.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker, Queue as BullQueue } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { RFP_LEGAL_SCAN, RFP_PROPOSAL_COMPILE } from '@bidstack/shared';
import { buildAgentUserMessage } from '../lib/prompt-safety.js';
import { logAiInvocation } from '../lib/ai-audit-worker.js';
import { getOrgDust, resolveAgentId } from '../lib/dust-credentials.js';
import {
  updateOrchestrationPhase,
  markOrchestrationFailed,
} from './rfp-requirement-extract.helpers.js';

const QUEUE_NAME = RFP_LEGAL_SCAN.name;
const DEFAULT_LEGAL_AGENT_ID = 'rfp-legal-scan-agent';

// Cap concatenated section text sent to Dust — legal scan is whole-document,
// so we budget more chars than per-section drafting but still hard-cap to
// prevent runaway token spend.
const MAX_SECTION_CONTENT_CHARS = 8_000;

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  proposalId: z.string().uuid(),
});
type JobData = z.infer<typeof JobData>;

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(
  job: Job<JobData>,
  log: pino.Logger,
  proposalCompileQueue: BullQueue,
): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, orchestrationId, proposalId } = parsed.data;

  // Verify proposal belongs to this org before touching any data
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId, orgId },
    select: { id: true },
  });
  if (!proposal) {
    const err = new Error(`rfp-legal-scan: proposal ${proposalId} not found for org ${orgId}`);
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  // Gather proposal section text — ordered by sortOrder so Dust sees a
  // coherent document, not a random assembly of sections.
  const sections = await prisma.proposalSection.findMany({
    where: { proposalId, orgId, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { title: true, content: true },
  });

  const sectionText = sections
    .map((s) => `## ${s.title ?? 'Untitled'}\n\n${s.content ?? ''}`)
    .join('\n\n')
    .slice(0, MAX_SECTION_CONTENT_CHARS);

  const { client: dust, creds } = await getOrgDust(orgId, log);
  const legalAgentId =
    resolveAgentId(creds, 'legalScan', process.env.DUST_RFP_LEGAL_SCAN_AGENT_ID) ??
    DEFAULT_LEGAL_AGENT_ID;
  let findings: string;

  if (dust) {
    const userMessage = buildAgentUserMessage({
      template:
        'Review this proposal draft for legal, compliance, liability, IP and data-privacy risks. ' +
        'Return a concise bullet list of flagged risks (or "No material legal risks found").',
      trusted: { PROPOSAL_ID: proposalId },
      rfpContent: sectionText,
    });

    const t0 = Date.now();
    try {
      const run = await dust.runAgent(legalAgentId, userMessage);
      findings = run.output ?? '[Legal scan returned no output — review manually.]';

      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-legal-scan',
          model: 'dust',
          prompt: userMessage,
          response: findings,
          tokenCount: 0,
          durationMs: Date.now() - t0,
          status: 'success',
          traceId: job.id ?? undefined,
        },
        log,
      );
    } catch (err) {
      // FAIL-OPEN: Dust errors must not block the pipeline. Write a placeholder
      // and continue — human reviewers will see the missing scan.
      log.warn(
        { err, proposalId },
        'rfp-legal-scan: Dust call failed — continuing with placeholder',
      );
      findings = '[Legal scan unavailable.]';
      await logAiInvocation(
        {
          orgId,
          agentType: 'rfp-legal-scan',
          model: 'dust',
          prompt: '',
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
    findings = '[Legal scan skipped — connect Dust in Settings.]';
  }

  // Advance orchestration state then chain proposal-compile.
  // WHY advance before enqueue: if enqueue fails the orchestration phase is
  // still correct and the compile job can be re-enqueued manually without
  // corrupting the completed_phases array.
  await updateOrchestrationPhase(orchestrationId, orgId, 'proposal_compile', 'legal_scan');

  await proposalCompileQueue.add(
    'rfp.proposal-compile',
    { orgId, orchestrationId, proposalId },
    { jobId: `rfp-proposal-compile-${orchestrationId}` },
  );

  log.info(
    { orgId, orchestrationId, proposalId, findingsLength: findings.length },
    'rfp-legal-scan: complete',
  );
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpLegalScan(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const proposalCompileQueue = new BullQueue(RFP_PROPOSAL_COMPILE.name, {
    connection,
    defaultJobOptions: RFP_PROPOSAL_COMPILE.defaultJobOptions,
  });
  queues.push(proposalCompileQueue);

  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id }), proposalCompileQueue),
    {
      connection,
      // WHY concurrency 4: legal scan is a HIGH-priority gate step — Dust-bound
      // but sequential per proposal. 4 allows concurrent proposals without
      // saturating the Dust API token budget.
      concurrency: 4,
      limiter: { max: 8, duration: 60_000 },
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, proposalId: job.data.proposalId }, 'rfp-legal-scan: completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-legal-scan: failed');
    const dataParsed = JobData.safeParse(job?.data);
    if (dataParsed.success) {
      const { orchestrationId, orgId } = dataParsed.data;
      markOrchestrationFailed(
        orchestrationId,
        orgId,
        'legal_scan',
        (err as Error).message?.slice(0, 2000) ?? 'unknown error',
      ).catch(() => undefined);
    }
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-legal-scan worker started');
}
