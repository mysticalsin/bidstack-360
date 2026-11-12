/**
 * GDPR data subject request worker (export / erase).
 *
 * Queue: data-subject-request (defined in @bidstack/shared DATA_SUBJECT_REQUEST)
 *
 * The API files a data_subject_requests row and enqueues { requestId, orgId }.
 * This worker runs exactly that row through runDataSubjectRequest, which claims
 * it, runs the engine (dry run unless the row says otherwise), writes the audit
 * event and stores a counts-only report. Re-delivery is safe: a row that is
 * already done is skipped by the claim. A row another run still holds, or one
 * whose uploaded portraits could not be deleted yet, comes back `busy`: the job
 * is delayed until the claim goes stale instead of completing.
 */

import { DelayedError, Worker, Queue, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma, runDataSubjectRequest } from '@bidstack/db';
import { DATA_SUBJECT_REQUEST, DataSubjectJob } from '@bidstack/shared';

import { deleteExportArchive } from '../lib/tenant-export-storage.js';

/** Uploaded portraits live in the default bucket, like export archives. */
async function deleteStoredObjects(keys: string[]): Promise<void> {
  for (const key of keys) await deleteExportArchive(key);
}

export async function processDataSubjectJob(
  job: Pick<Job, 'data'> & Partial<Pick<Job, 'moveToDelayed'>>,
  log: pino.Logger,
  token?: string,
  deleteObjects: (keys: string[]) => Promise<void> = deleteStoredObjects,
): Promise<Awaited<ReturnType<typeof runDataSubjectRequest>>> {
  const parsed = DataSubjectJob.safeParse(job.data);
  if (!parsed.success) throw new Error('data-subject-request: invalid job data');
  const out = await runDataSubjectRequest(prisma, parsed.data.requestId, parsed.data.orgId, {
    deleteObjects,
    log,
  });
  // errorDetail can echo row values; logs get the stored code only.
  const { errorDetail: _detail, ...safe } = out as typeof out & { errorDetail?: unknown };
  if (out.status === 'failed') log.error(safe, 'data subject request failed');
  else log.info(safe, 'data subject request processed');
  if (out.status === 'busy') {
    if (!job.moveToDelayed) throw new Error('data-subject-request: busy, retry later');
    await job.moveToDelayed((out.retryAt ?? new Date(Date.now() + 60_000)).getTime(), token);
    // BullMQ needs DelayedError after moveToDelayed, or it tries to complete the job.
    throw new DelayedError();
  }
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
    (job: Job, token?: string) => processDataSubjectJob(job, log.child({ jobId: job.id }), token),
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'data subject request failed');
  });
  workers.push(worker);
  log.info('data subject request worker started');
}
