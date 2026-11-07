/**
 * email-sync.ts — Outlook email sync worker (BS-R1 file-size refactor).
 *
 * Three job types:
 *  email.outlook.pull-incremental  — webhook-triggered or 5-min fallback poll
 *  email.outlook.pull-historical   — full-inbox seed on first connect
 *  email.outlook.subscription-renew — daily cron renews expiring Graph subs
 *
 * Implementation split:
 *   email-sync.helpers.ts      — job schema, token accessor
 *   email-sync.pull.ts         — pullDelta (delta link pagination + upsert)
 *   email-sync.subscriptions.ts — renewSub (PATCH + 404-recreate)
 *
 * WHY re-implemented here instead of imported from apps/api:
 * Cross-app imports create circular build dependencies. If this diverges too
 * far, extract to a @bidstack/email-sync package.
 */
import { DelayedError, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma, IntegrationProvider } from '@bidstack/db';
import {
  OUTLOOK_PULL_HISTORICAL,
  OUTLOOK_PULL_INCREMENTAL,
  OUTLOOK_SUBSCRIPTION_RENEW,
} from '@bidstack/shared';

import { PullJobData } from './email-sync.helpers.js';
import { ProviderRateLimitError } from '../lib/provider-http.js';
import { GrantRevokedError } from '../lib/workspace-token.js';
import { pullDelta } from './email-sync.pull.js';
import { renewSub } from './email-sync.subscriptions.js';

export function startEmailSync(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): void {
  const pullQueue = new Queue(OUTLOOK_PULL_INCREMENTAL.name, {
    connection,
    defaultJobOptions: OUTLOOK_PULL_INCREMENTAL.defaultJobOptions,
  });
  const historicalQueue = new Queue(OUTLOOK_PULL_HISTORICAL.name, {
    connection,
    defaultJobOptions: OUTLOOK_PULL_HISTORICAL.defaultJobOptions,
  });
  const renewalQueue = new Queue(OUTLOOK_SUBSCRIPTION_RENEW.name, {
    connection,
    defaultJobOptions: OUTLOOK_SUBSCRIPTION_RENEW.defaultJobOptions,
  });

  queues.push(pullQueue, historicalQueue, renewalQueue);

  // ── Incremental pull worker ──
  const incrementalWorker = new Worker(
    OUTLOOK_PULL_INCREMENTAL.name,
    async (job) => {
      if (job.name === 'email.outlook.fanout') {
        // Fan-out: enqueue one pull job per active Outlook token, in bounded pages.
        const windowBucket = Math.floor(Date.now() / 60_000);
        let cursor: string | undefined;
        let count = 0;
        while (true) {
          const tokens = await prisma.integrationToken.findMany({
            where: {
              provider: IntegrationProvider.microsoft_graph,
              status: 'active',
              deletedAt: null,
            },
            select: { id: true, orgId: true, userId: true },
            take: 200,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: 'asc' },
          });
          for (const token of tokens) {
            await pullQueue.add(
              OUTLOOK_PULL_INCREMENTAL.name,
              { orgId: token.orgId, userId: token.userId, integrationTokenId: token.id },
              // Dedup within the current 1-minute window
              { jobId: `incremental-${token.id}-${windowBucket}` },
            );
          }
          count += tokens.length;
          if (tokens.length < 200) break;
          cursor = tokens[tokens.length - 1]!.id;
        }

        log.info({ count }, 'outlook pull fanout dispatched');
        return;
      }

      const data = PullJobData.parse(job.data);
      log.info({ jobId: job.id, orgId: data.orgId }, 'outlook pull-incremental start');

      try {
        const { persisted } = await pullDelta(data, log);
        log.info({ jobId: job.id, persisted }, 'outlook pull-incremental complete');
      } catch (err) {
        if (err instanceof ProviderRateLimitError) {
          log.warn({ jobId: job.id, delayMs: err.retryAfterMs }, 'Graph throttled; delaying job');
          await job.moveToDelayed(Date.now() + err.retryAfterMs, job.token);
          // BullMQ needs DelayedError after moveToDelayed, or it tries to complete the job.
          throw new DelayedError();
        }
        if (err instanceof GrantRevokedError) {
          log.warn({ jobId: job.id }, 'Outlook grant revoked; skipping until reconnect');
          return;
        }
        throw err;
      }
    },
    { connection, concurrency: 5, limiter: { max: 10, duration: 1_000 } },
  );

  incrementalWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'outlook pull-incremental failed');
  });

  // ── Historical pull worker ──
  const historicalWorker = new Worker(
    OUTLOOK_PULL_HISTORICAL.name,
    async (job) => {
      const data = PullJobData.parse(job.data);
      log.info({ jobId: job.id, orgId: data.orgId }, 'outlook pull-historical start');

      // Reset only the mail cursors to force a full pull; calendar cursors stay.
      const row = await prisma.integrationToken.findFirst({
        where: { id: data.integrationTokenId, orgId: data.orgId },
        select: { deltaState: true },
      });
      if (!row) return;
      const {
        mailDeltaLink: _a,
        mailNextLink: _b,
        mailSentDeltaLink: _c,
        mailSentNextLink: _d,
        ...rest
      } = (row.deltaState ?? {}) as Record<string, unknown>;
      await prisma.integrationToken.update({
        where: { id: data.integrationTokenId },
        data: { deltaState: rest as object },
      });

      const { persisted } = await pullDelta(data, log);
      log.info({ jobId: job.id, persisted }, 'outlook pull-historical complete');
    },
    { connection, concurrency: 2 },
  );

  historicalWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'outlook pull-historical failed');
  });

  // ── Subscription renewal worker ──
  const renewalWorker = new Worker(
    OUTLOOK_SUBSCRIPTION_RENEW.name,
    async (job) => {
      const subscriptionId = (job.data as { subscriptionId?: string }).subscriptionId;

      if (subscriptionId) {
        // Single-subscription renewal (triggered by disconnect/manual)
        await renewSub(subscriptionId, log);
        return;
      }

      // Bulk: find all subscriptions expiring within 26 h
      const horizon = new Date(Date.now() + 26 * 60 * 60 * 1_000);
      const subs = await prisma.graphSubscription.findMany({
        where: { expiresAt: { lte: horizon } },
        select: { subscriptionId: true },
      });

      log.info({ count: subs.length }, 'outlook subscription-renew: subs due for renewal');

      for (const sub of subs) {
        try {
          await renewSub(sub.subscriptionId, log);
        } catch (err) {
          log.error({ err, subscriptionId: sub.subscriptionId }, 'subscription renewal error');
        }
      }
    },
    { connection, concurrency: 1 },
  );

  renewalWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'outlook subscription-renew failed');
  });

  workers.push(incrementalWorker, historicalWorker, renewalWorker);

  // Schedule recurring jobs (idempotent — BullMQ deduplicates by jobId)
  void pullQueue
    .add(
      'email.outlook.fanout',
      {},
      { jobId: 'outlook-fanout-cron', repeat: { every: 5 * 60 * 1_000 } },
    )
    .then(() => log.info('outlook fanout cron scheduled'));

  void renewalQueue
    .add(
      OUTLOOK_SUBSCRIPTION_RENEW.name,
      {},
      { jobId: 'outlook-subscription-renew-cron', repeat: { pattern: '0 2 * * *' } },
    )
    .then(() => log.info('outlook subscription-renew cron scheduled'));
}
