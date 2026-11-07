/**
 * GDPR data subject request worker (export / erase).
 *
 * Queue: data-subject-request (defined in @bidstack/shared DATA_SUBJECT_REQUEST)
 *
 * The API files a data_subject_requests row and enqueues { requestId, orgId }.
 * This worker runs exactly that row through runDataSubjectRequest, which claims
 * it, runs the engine (dry run unless the row says otherwise), writes the audit
 * event and stores a counts-only report. Re-delivery is safe: a row that is
 * already done is skipped by the claim.
 */

import { Worker, Queue, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma, runDataSubjectRequest } from '@bidstack/db';
import { DATA_SUBJECT_REQUEST, DataSubjectJob } from '@bidstack/shared';

export async function processDataSubjectJob(
  job: Pick<Job, 'data'>,
  log: pino.Logger,
): Promise<Awaited<ReturnType<typeof runDataSubjectRequest>>> {
  const parsed = DataSubjectJob.safeParse(job.data);
  if (!parsed.success) throw new Error('data-subject-request: invalid job data');
  const out = await runDataSubjectRequest(prisma, parsed.data.requestId);
  log.info(out, 'data subject request processed');
  return out;
}

export async function startDataSubjectWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(DATA_SUBJECT_REQUEST.name, {
    connection,
    defaultJobOptions: DATA_SUBJECT_REQUEST.defaultJobOptions,
  });
  queues.push(queue);

  const worker = new Worker(
    DATA_SUBJECT_REQUEST.name,
    (job: Job) => processDataSubjectJob(job, log.child({ jobId: job.id })),
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'data subject request failed');
  });
  workers.push(worker);
  log.info('data subject request worker started');
}
