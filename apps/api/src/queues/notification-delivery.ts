// Producer for the `notification-delivery` queue. apps/worker sends the email
// or Teams post (apps/worker/src/queues/notification-delivery.ts).

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { NOTIFICATION_DELIVERY, type NotificationDeliveryJob } from '@bidstack/shared';

import { createLogger } from '../lib/logger.js';
import { addWithinDeadline } from '../lib/queue-enqueue.js';

const log = createLogger({ name: 'queue:notification-delivery' });

let queueSingleton: Queue | null = null;

export type DeliverJob = Extract<NotificationDeliveryJob, { kind: 'deliver' }>;
type Enqueue = (job: DeliverJob) => Promise<string | null>;
let enqueueOverride: Enqueue | null = null;

/** Tests capture enqueues instead of talking to Redis. Pass null to reset. */
export function __setNotificationDeliveryEnqueueForTest(fn: Enqueue | null): void {
  enqueueOverride = fn;
}

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  connection.on('error', (err) => {
    log.error({ err }, 'Redis connection error in notification-delivery queue');
  });
  queueSingleton = new Queue(NOTIFICATION_DELIVERY.name, {
    connection,
    defaultJobOptions: NOTIFICATION_DELIVERY.defaultJobOptions,
  });
  return queueSingleton;
}

/** Fail-open: a queue outage never blocks the write that raised the alert. */
export async function enqueueNotificationDelivery(job: DeliverJob): Promise<string | null> {
  if (enqueueOverride) return enqueueOverride(job);
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true')
    return null;
  try {
    const queued = await addWithinDeadline(getQueue(), (q) => q.add('notification-delivery.deliver', job));
    return queued.id ?? null;
  } catch (err) {
    log.error(
      { err, orgId: job.orgId, userId: job.userId, channel: job.channel },
      'Failed to enqueue notification delivery',
    );
    return null;
  }
}
