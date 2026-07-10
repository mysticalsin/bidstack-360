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
//
// Implementation split:
//   rfp-requirement-extract.helpers.ts   — schemas + pure helpers
//   rfp-requirement-extract.processor.ts — processJob
//   rfp-requirement-extract.ts           — BullMQ bootstrap (this file)

import type { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker, Queue as BullQueue } from 'bullmq';
import { MemOSService } from '@bidstack/memos';
import { RFP_EMBED_REQUIREMENT, RFP_STORY_MATCH } from '@bidstack/shared';

import {
  JobData,
  QUEUE_NAME,
  EMBED_QUEUE_NAME,
  STORY_MATCH_QUEUE_NAME,
  markOrchestrationFailed,
} from './rfp-requirement-extract.helpers.js';
import { processJob } from './rfp-requirement-extract.processor.js';

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

  // WHY storyMatchQueue created here: requirement-extract is the fan-out
  // producer for story-match; creating the queue handle here (not in the
  // story-match worker's bootstrap) avoids a shared-queue reference cycle.
  const storyMatchQueue = new BullQueue(STORY_MATCH_QUEUE_NAME, {
    connection,
    defaultJobOptions: RFP_STORY_MATCH.defaultJobOptions,
  });
  queues.push(storyMatchQueue);

  const memos = new MemOSService();

  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) =>
      processJob(job, log.child({ jobId: job.id }), embedQueue, storyMatchQueue, memos),
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
    ).catch((markErr) =>
      log.warn({ err: markErr }, 'best-effort orchestration failure mark write failed'),
    );
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-requirement-extract worker started');
}
