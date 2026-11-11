// Starts that carry a client uploadId (start-csv, start-hubspot).

import type { Queue } from 'bullmq';

import { prisma } from '@bidstack/db';
import { MIGRATION } from '@bidstack/shared';

import { addWithinDeadline } from './queue-enqueue.js';

// Covers the wait for a start in flight plus that start's enqueue and writes.
const UPLOAD_LOCK_TIMEOUT_MS = 30_000;

/**
 * Runs the starts that carry the same uploadId one after another, across API
 * instances: a retry sent while the first attempt is still running waits for
 * it, then finds its job instead of starting a second import. The lock is
 * transaction-scoped and `run` writes on autocommit, so the next holder sees
 * those writes. The unique (org, uploadId) index backs this up.
 */
export function withUploadLock<T>(orgId: string, uploadId: string, run: () => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`migration-start:${orgId}:${uploadId}`}))`;
      return run();
    },
    { maxWait: UPLOAD_LOCK_TIMEOUT_MS, timeout: UPLOAD_LOCK_TIMEOUT_MS },
  );
}

type WarnLog = { warn(obj: object, msg: string): void };

/**
 * Re-adding a chunk is a no-op only while BullMQ still holds a job with that
 * id. MIGRATION keeps a completed chunk for 7 days and only the last 500
 * (removeOnComplete), so a start resumed after that queues chunks that
 * already ran again and their rows are imported a second time. Warns when a
 * resume is past that window: the start is older than the age limit, or one
 * of its chunks is no longer in the queue.
 */
export async function warnIfPastRetryWindow(
  queue: Queue,
  log: WarnLog,
  migrationJobId: string,
  createdAt: Date,
  chunkJobIds: readonly string[],
): Promise<void> {
  const retention = MIGRATION.defaultJobOptions.removeOnComplete;
  const ageMs = Date.now() - createdAt.getTime();
  const held = await addWithinDeadline(queue, (q) => Promise.all(chunkJobIds.map((id) => q.getJob(id))));
  const missingChunks = chunkJobIds.filter((_, i) => !held[i]);
  if (ageMs > retention.age * 1000 || missingChunks.length > 0) {
    log.warn(
      { migrationJobId, ageMs, missingChunks, retention },
      'resuming a migration start past the queue retry window; chunks that already ran may import their rows again',
    );
  }
}
