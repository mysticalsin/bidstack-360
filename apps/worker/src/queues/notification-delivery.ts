/**
 * notification-delivery queue worker (slice 21). Job names:
 *   notification-delivery.deliver  one email or Teams copy of an alert
 *   notification-delivery.digest   repeatable (daily): account digest email
 */
import { prisma } from '@bidstack/db';
import { NOTIFICATION_DELIVERY, type NotificationDeliveryJob } from '@bidstack/shared';
import { decryptSecret } from '@bidstack/shared/server-crypto';
import { type Job, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import {
  deliverOne,
  sendDailyDigest,
  type DeliveryDeps,
  type DeliveryLimiter,
  type DeliveryStore,
} from '../lib/notification-delivery.js';

const DAY_MS = 24 * 60 * 60_000;

export const prismaDeliveryStore: DeliveryStore = {
  async findUser(orgId, userId) {
    return prisma.user.findFirst({
      where: { id: userId, orgId, deletedAt: null },
      select: { email: true, name: true },
    });
  },
  async findTeamsWebhookEnc(orgId, userId) {
    const row = await prisma.notificationPref.findFirst({
      where: { orgId, userId },
      select: { teamsWebhookEnc: true },
    });
    return row?.teamsWebhookEnc ?? null;
  },
  async markSent({ orgId, notificationId, channel, at }) {
    await prisma.notification.updateMany({
      where: { id: notificationId, orgId },
      data: channel === 'email' ? { emailSentAt: at } : { teamsSentAt: at },
    });
  },
  async digestRecipients(limit) {
    const rows = await prisma.notificationPref.findMany({
      where: { accountDigestDaily: true, user: { deletedAt: null } },
      select: { orgId: true, userId: true },
      orderBy: { userId: 'asc' },
      take: limit,
    });
    return rows;
  },
  async digestItems(orgId, userId, since) {
    return prisma.notification.findMany({
      where: { orgId, userId, type: 'account_activity', createdAt: { gte: since } },
      select: { title: true, body: true, url: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  },
};

export function redisLimiter(connection: IORedis): DeliveryLimiter {
  return {
    async claim(key, ttlSeconds, owner) {
      const set = await connection.set(key, owner, 'EX', ttlSeconds, 'NX');
      if (set === 'OK') return true;
      return (await connection.get(key)) === owner;
    },
    async incr(key, ttlSeconds) {
      const n = await connection.incr(key);
      if (n === 1) await connection.expire(key, ttlSeconds);
      return n;
    },
  };
}

/** Start the notification-delivery worker and its daily digest. */
export async function startNotificationDelivery(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const queue = new Queue(NOTIFICATION_DELIVERY.name, {
    connection,
    defaultJobOptions: NOTIFICATION_DELIVERY.defaultJobOptions,
  });
  queues.push(queue);
  const deps: DeliveryDeps = {
    store: prismaDeliveryStore,
    limiter: redisLimiter(connection),
    decrypt: (blob) => decryptSecret(blob),
    fetchImpl: fetch,
    env,
    log,
    now: () => new Date(),
  };

  const worker = new Worker<NotificationDeliveryJob>(
    NOTIFICATION_DELIVERY.name,
    async (job: Job<NotificationDeliveryJob>) => {
      if (job.data.kind === 'digest') return sendDailyDigest(deps);
      const outcome = await deliverOne(job.data, deps, String(job.id));
      log.info(
        { jobId: job.id, channel: job.data.channel, outcome },
        'notification delivery finished',
      );
      return outcome;
    },
    { connection, concurrency: 4, limiter: { max: 30, duration: 1000 } },
  );
  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'notification delivery job failed');
  });
  workers.push(worker);

  await queue.add(
    'notification-delivery.digest',
    { kind: 'digest' },
    { repeat: { every: DAY_MS }, jobId: 'notification-delivery-digest' },
  );
  log.info(
    {
      queue: NOTIFICATION_DELIVERY.name,
      emailConfigured: !!(env.RESEND_API_KEY && env.NOTIFICATION_FROM_EMAIL),
    },
    'notification delivery worker started',
  );
}
