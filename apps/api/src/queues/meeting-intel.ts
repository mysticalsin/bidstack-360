// Producer for the `meeting-intel` queue. The API enqueues ABC syncs, pushed
// Metis items to process, and flag computation for manual entries; apps/worker
// runs the pipeline (apps/worker/src/meeting-intel/pipeline.ts).

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { MEETING_INTEL, type MeetingIntelJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'queue:meeting-intel' });

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

type Enqueue = (job: MeetingIntelJob) => Promise<string | null>;
let enqueueOverride: Enqueue | null = null;

/** Tests capture enqueues instead of talking to Redis. Pass null to reset. */
export function __setMeetingIntelEnqueueForTest(fn: Enqueue | null): void {
  enqueueOverride = fn;
}

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;
  connectionSingleton = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis connection error in meeting-intel queue');
  });
  queueSingleton = new Queue(MEETING_INTEL.name, {
    connection: connectionSingleton,
    defaultJobOptions: MEETING_INTEL.defaultJobOptions,
  });
  return queueSingleton;
}

function jobId(job: MeetingIntelJob): string {
  if (job.kind === 'process') return `${job.orgId}--item--${job.itemId}`;
  if (job.kind === 'sync') return `${job.orgId}--sync--${job.connectionId}--${Date.now()}`;
  if (job.kind === 'mars-sync') return `${job.orgId}--mars--${Math.floor(Date.now() / 60_000)}`;
  return `${job.orgId}--flags--${job.meetingId}--${Date.now()}`;
}

/** Fail-open: returns null when Redis is unreachable (the hourly scan retries syncs). */
export async function enqueueMeetingIntel(job: MeetingIntelJob): Promise<string | null> {
  if (enqueueOverride) return enqueueOverride(job);
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') return null;
  try {
    const queued = await getQueue().add(`meeting-intel.${job.kind}`, job, { jobId: jobId(job) });
    return queued.id ?? null;
  } catch (err) {
    log.error({ err, orgId: job.orgId, kind: job.kind }, 'Failed to enqueue meeting intel job');
    return null;
  }
}
