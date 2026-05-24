/**
 * BullMQ Queue client for Outlook email sync jobs.
 *
 * WHY a shared client file: the API (webhook handler) and the worker both need
 * to add jobs to the same queue. Centralising the Queue instance here ensures
 * both use the same queue name and Redis connection config.
 *
 * Queue names:
 *   email.outlook.pull-incremental  — delta pull triggered by webhook or cron
 *   email.outlook.pull-historical   — one-shot backfill on first connect
 *   email.outlook.subscription-renew — daily cron: renew near-expiry subscriptions
 */

import { Queue } from 'bullmq';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

function makeConnection() {
  return {
    host: new URL(redisUrl).hostname,
    port: Number(new URL(redisUrl).port || 6379),
  };
}

export const OUTLOOK_PULL_INCREMENTAL = 'email.outlook.pull-incremental';
export const OUTLOOK_PULL_HISTORICAL = 'email.outlook.pull-historical';
export const OUTLOOK_SUBSCRIPTION_RENEW = 'email.outlook.subscription-renew';

export const outlookEmailQueue = new Queue(OUTLOOK_PULL_INCREMENTAL, {
  connection: makeConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 500,
    removeOnFail: 100,
  },
});

export const outlookHistoricalQueue = new Queue(OUTLOOK_PULL_HISTORICAL, {
  connection: makeConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 30_000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const outlookRenewalQueue = new Queue(OUTLOOK_SUBSCRIPTION_RENEW, {
  connection: makeConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: 50,
    removeOnFail: 50,
  },
});
