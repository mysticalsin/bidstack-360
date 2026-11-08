// Dead-letter queue. BullMQ keeps exhausted jobs in each queue's own failed
// set, which is pruned by removeOnFail and scattered across ~40 queues. On the
// final failed attempt we copy the job into one `dead-letter` queue so an
// operator has a single place to inspect and replay exhausted work.
//
// Not covered: a job that exceeds maxStalledCount is failed inside a Redis
// script without the Worker `failed` event, so it never reaches this queue.

import type { Job, Queue, Worker } from 'bullmq';
import type pino from 'pino';

export const DEAD_LETTER_QUEUE = 'dead-letter';
/** Entries older than this are trimmed; the payload may hold personal data. */
export const DEAD_LETTER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeadLetterEntry {
  queue: string;
  jobId: string | null;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

type FailedJob = Pick<Job, 'id' | 'name' | 'data' | 'attemptsMade' | 'opts'> & {
  finishedOn?: number | null;
};

/**
 * True when BullMQ will not retry this job again. finishedOn is set only when
 * the job moves to failed for good, which also covers UnrecoverableError and
 * job.discard() with attempts left.
 */
export function isFinalAttempt(job: Pick<FailedJob, 'attemptsMade' | 'opts' | 'finishedOn'>): boolean {
  if (job.finishedOn != null) return true;
  return job.attemptsMade >= (job.opts?.attempts ?? 1);
}

export function deadLetterEntry(queue: string, job: FailedJob, err: Error, now = new Date()): DeadLetterEntry {
  return {
    queue,
    jobId: job.id ?? null,
    name: job.name,
    data: job.data,
    failedReason: (err?.message ?? 'unknown error').slice(0, 2000),
    attemptsMade: job.attemptsMade,
    failedAt: now.toISOString(),
  };
}

/**
 * Deterministic id, so a duplicate `failed` event cannot dead-letter twice.
 * ":" is replaced because BullMQ rejects most custom ids containing it
 * (repeatable job ids do).
 */
export function deadLetterJobId(queue: string, job: Pick<Job, 'id'>): string | undefined {
  return job.id ? `${queue}__${job.id}`.replace(/:/g, '_') : undefined;
}

export function attachDeadLetter(
  worker: Pick<Worker, 'name' | 'on'>,
  dlq: Pick<Queue, 'add'>,
  log: pino.Logger,
): void {
  if (worker.name === DEAD_LETTER_QUEUE) return;
  worker.on('failed', (job: FailedJob | undefined, err: Error) => {
    if (!job || !isFinalAttempt(job)) return;
    const entry = deadLetterEntry(worker.name, job, err);
    void dlq
      .add('dead-letter', entry, {
        jobId: deadLetterJobId(worker.name, job),
        removeOnComplete: true,
        removeOnFail: false,
      })
      .catch((dlqErr: unknown) =>
        log.error({ err: dlqErr, queue: worker.name, jobId: job.id }, 'dead-letter: enqueue failed'),
      );
  });
}

/** Drop dead-letter entries past the retention window. Returns the count removed. */
export async function trimDeadLetter(
  dlq: Pick<Queue, 'clean'>,
  retentionMs = DEAD_LETTER_RETENTION_MS,
): Promise<number> {
  const removed = await dlq.clean(retentionMs, 1000, 'wait');
  return removed.length;
}
