// RFP proposal compile worker.
//
// PURE ASSEMBLY — no LLM call.
//
// Assembles all drafted ProposalSection rows (ordered by sortOrder) into a
// single Markdown document, writes it to Proposal.compiledContent, then
// advances the orchestration phase to qa_review and enqueues the qa-review job.
//
// WHY no Dust call here: compiledContent is deterministic — it is a structural
// join of section drafts. Sending the assembled document to an LLM at this
// stage would duplicate the QA worker's responsibility and burn token budget
// twice. The qa-review worker applies the LLM judgment pass.
//
// WHY concurrency 2: assembly is CPU-light (string concatenation + two DB
// queries). Sequential per proposal by design (one compile job per proposal),
// so 2 slots handles bursts without database connection pressure.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker, Queue as BullQueue } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { RFP_PROPOSAL_COMPILE, RFP_QA_REVIEW } from '@bidstack/shared';
import {
  updateOrchestrationPhase,
  markOrchestrationFailed,
} from './rfp-requirement-extract.helpers.js';

const QUEUE_NAME = RFP_PROPOSAL_COMPILE.name;

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  proposalId: z.string().uuid(),
});
type JobData = z.infer<typeof JobData>;

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(
  job: Job<JobData>,
  log: pino.Logger,
  qaReviewQueue: BullQueue,
): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`rfp-proposal-compile: invalid job data — ${parsed.error.message}`);
  }

  const { orgId, orchestrationId, proposalId } = parsed.data;

  // Verify the proposal belongs to this org before touching any data.
  // doNotRetry=true: a missing proposal means the pipeline references a
  // non-existent entity — retrying will not fix it.
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId, orgId },
    select: { id: true },
  });
  if (!proposal) {
    const err = new Error(
      `rfp-proposal-compile: proposal ${proposalId} not found for org ${orgId}`,
    );
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  // Load all non-deleted sections ordered by sortOrder.
  // WHY orderBy sortOrder: the compiled document must reflect the human-defined
  // section order, not insertion order.
  const sections = await prisma.proposalSection.findMany({
    where: { proposalId, orgId, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { title: true, content: true },
  });

  // Assemble Markdown. Each section becomes an H1 heading followed by its
  // content. Sections are separated by a blank line so the rendered document
  // has clear visual breaks.
  // WHY we guard on empty: a proposal with no sections is valid mid-pipeline
  // (drafting may still be in flight); we store a sentinel so downstream QA
  // can flag it rather than receiving an empty string.
  const compiled =
    sections.length > 0
      ? sections.map((s) => `# ${s.title}\n\n${s.content}`).join('\n\n')
      : '[No sections drafted yet.]';

  // Persist the compiled content and timestamp.
  await prisma.proposal.update({
    where: { id: proposalId, orgId },
    data: {
      compiledContent: compiled,
      compiledAt: new Date(),
    },
  });

  // Advance orchestration state and chain the next pipeline stage.
  // updateOrchestrationPhase records 'proposal_compile' as complete and moves
  // current_phase to 'qa_review'. The qa-review job is then enqueued so the
  // QA worker picks it up immediately.
  await updateOrchestrationPhase(orchestrationId, orgId, 'qa_review', 'proposal_compile');

  // WHY deterministic jobId: prevents duplicate qa-review jobs if this worker
  // retries after a partial failure (e.g. DB write succeeded but queue add timed out).
  await qaReviewQueue.add(
    'rfp.qa-review',
    { orgId, orchestrationId, proposalId },
    { jobId: `rfp-qa-review:${orchestrationId}` },
  );

  log.info(
    {
      orgId,
      orchestrationId,
      proposalId,
      sectionCount: sections.length,
      compiledLength: compiled.length,
    },
    'rfp-proposal-compile: complete',
  );
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpProposalCompile(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  // Instantiate the downstream qa-review queue so we can enqueue after assembly.
  // Registered in queues[] so main.ts can drain + close it on shutdown.
  const qaReviewQueue = new BullQueue(RFP_QA_REVIEW.name, {
    connection,
    defaultJobOptions: RFP_QA_REVIEW.defaultJobOptions,
  });
  queues.push(qaReviewQueue);

  // WHY concurrency 2: assembly is CPU-light (string concat + two Prisma calls).
  // Sequential per proposal by design; 2 slots absorbs burst without opening
  // excess DB connections.
  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id }), qaReviewQueue),
    { connection, concurrency: 2 },
  );

  worker.on('completed', (job) => {
    log.info(
      { jobId: job.id, proposalId: job.data.proposalId },
      'rfp-proposal-compile: job completed',
    );
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-proposal-compile: job failed');

    // Best-effort orchestration failure mark — non-critical if this itself fails
    // (the orchestration will timeout via its own watchdog).
    const parsed = JobData.safeParse(job?.data);
    if (parsed.success) {
      const { orchestrationId, orgId } = parsed.data;
      markOrchestrationFailed(
        orchestrationId,
        orgId,
        'proposal_compile',
        (err as Error).message.slice(0, 2000),
      ).catch(() => undefined);
    }
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-proposal-compile worker started');
}
