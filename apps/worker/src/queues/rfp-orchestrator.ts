// RFP orchestration worker — FlowProducer conductor.
//
// Receives one job per RFP upload. Validates tenant ownership, creates the
// RfpOrchestration state-machine record, then launches the extraction phase
// as a BullMQ child job.
//
// WHY raw SQL for RfpOrchestration: the Wave 9 Prisma schema was added but
// db:generate can't run on Windows while the API server holds the .dll lock.
// All SQL values are parameterized — safe against injection.

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker, Queue as BullQueue } from 'bullmq';
import { z } from 'zod';
import { prisma } from '@bidstack/db';

import { RFP_ORCHESTRATE, RFP_REQUIREMENT_EXTRACT } from '@bidstack/shared';

const QUEUE_NAME = RFP_ORCHESTRATE.name;

// ─── Job schema ────────────────────────────────────────────────────────────

const JobData = z.object({
  orgId: z.string().uuid(),
  rfpRequestId: z.string().min(1),
  documentVersionId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  proposalId: z.string().uuid().optional(),
  startedByUserId: z.string().uuid().optional(),
});
type JobData = z.infer<typeof JobData>;

// ─── Helpers ───────────────────────────────────────────────────────────────

interface OrchestrationRow {
  id: string;
  org_id: string;
}

async function upsertOrchestration(
  data: JobData,
  rootJobId: string | null,
): Promise<OrchestrationRow> {
  // WHY raw upsert: RfpOrchestration is not in the generated Prisma client yet
  // (Wave 9 schema, Windows DLL lock prevents db:generate). All values parameterized.
  const rows = await prisma.$queryRaw<OrchestrationRow[]>`
    INSERT INTO rfp_orchestrations (
      id, org_id, rfp_request_id, document_version_id,
      opportunity_id, proposal_id, started_by_user_id,
      state, current_phase, completed_phases, root_job_id, started_at,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${data.orgId}::uuid,
      ${data.rfpRequestId},
      ${data.documentVersionId}::uuid,
      ${data.opportunityId ?? null}::uuid,
      ${data.proposalId ?? null}::uuid,
      ${data.startedByUserId ?? null}::uuid,
      'running',
      'requirement_extract',
      ARRAY[]::text[],
      ${rootJobId},
      now(),
      now(),
      now()
    )
    ON CONFLICT ON CONSTRAINT uniq_org_rfp_active
    DO UPDATE SET
      state         = 'running',
      current_phase = 'requirement_extract',
      failed_phase  = NULL,
      failure_reason = NULL,
      root_job_id   = ${rootJobId},
      started_at    = now(),
      updated_at    = now()
    RETURNING id, org_id
  `;
  if (!rows.length) throw new Error('upsertOrchestration: no row returned');
  // rows[0] is defined — the length check above guarantees it
  return rows[0]!;
}

async function markOrchestrationFailed(
  orgId: string,
  rfpRequestId: string,
  phase: string,
  reason: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE rfp_orchestrations
    SET state = 'failed', failed_phase = ${phase}, failure_reason = ${reason}, updated_at = now()
    WHERE org_id = ${orgId}::uuid AND rfp_request_id = ${rfpRequestId}
  `;
}

// ─── Core processor ────────────────────────────────────────────────────────

async function processJob(
  job: Job<JobData>,
  log: pino.Logger,
  extractQueue: BullQueue,
): Promise<void> {
  const parsed = JobData.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`Invalid job data: ${parsed.error.message}`);
  }

  const { orgId, rfpRequestId, documentVersionId, opportunityId, proposalId, startedByUserId } =
    parsed.data;

  const orchestration = await upsertOrchestration(
    { orgId, rfpRequestId, documentVersionId, opportunityId, proposalId, startedByUserId },
    job.id ?? null,
  );

  if (orchestration.org_id !== orgId) {
    const err = new Error('rfp-orchestrator: cross-org mismatch on upsert');
    (err as Error & { doNotRetry?: boolean }).doNotRetry = true;
    throw err;
  }

  const orchestrationId = orchestration.id;
  log.info({ orgId, orchestrationId, rfpRequestId }, 'rfp-orchestrator: pipeline launched');

  // Enqueue extraction job (one per upload, deduped by jobId)
  await extractQueue.add(
    'rfp.requirement-extract',
    {
      orgId,
      rfpRequestId,
      documentVersionId,
      orchestrationId,
      chunkIndex: 0,
      totalChunks: 1,
    },
    {
      jobId: `rfp-req-extract-${orchestrationId}`,
      attempts: RFP_REQUIREMENT_EXTRACT.defaultJobOptions.attempts,
      backoff: RFP_REQUIREMENT_EXTRACT.defaultJobOptions.backoff,
    },
  );

  log.info({ orgId, orchestrationId }, 'rfp-orchestrator: extract job enqueued');
}

// ─── BullMQ bootstrap ──────────────────────────────────────────────────────

export async function startRfpOrchestrator(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const extractQueue = new BullQueue(RFP_REQUIREMENT_EXTRACT.name, {
    connection,
    defaultJobOptions: RFP_REQUIREMENT_EXTRACT.defaultJobOptions,
  });
  queues.push(extractQueue);

  const worker = new BullWorker<JobData>(
    QUEUE_NAME,
    async (job) => processJob(job, log.child({ jobId: job.id }), extractQueue),
    {
      connection,
      // WHY concurrency 1: one orchestration at a time to prevent duplicate
      // pipeline launches for the same org+rfpRequest
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    log.info(
      { jobId: job.id, orgId: job.data.orgId, rfpRequestId: job.data.rfpRequestId },
      'rfp-orchestrator: extract phase dispatched',
    );
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'rfp-orchestrator: job failed');
    if (!job) return;
    const p = JobData.safeParse(job.data);
    if (!p.success) return;
    markOrchestrationFailed(
      p.data.orgId,
      p.data.rfpRequestId,
      'orchestrate',
      err.message.slice(0, 2000),
    ).catch(() => undefined);
  });

  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'rfp-orchestrator worker started');
}
