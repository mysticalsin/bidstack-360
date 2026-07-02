/**
 * Calendar two-way sync worker.
 *
 * Three job types (all on separate BullMQ queues for independent scaling):
 *
 *   calendar.push          — called by API when an event is created/updated/deleted
 *                            locally; pushes the change to Google or MS Graph.
 *   calendar.pull-incremental — uses Google sync tokens or MS Graph delta links
 *                            to pull just-changed events (runs every 2 min).
 *   calendar.watch-renew   — renews Google push-notification channels before
 *                            they expire (7-day TTL; runs daily).
 *
 * WHY separate queues: push needs low-latency; pull can tolerate a minute delay;
 * renewal can run once daily without affecting throughput on the other queues.
 */

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma } from '@bidstack/db';
import { CALENDAR_PUSH, CALENDAR_PULL_INCREMENTAL, CALENDAR_WATCH_RENEW } from '@bidstack/shared';
import { decryptToken } from '@bidstack/shared/token-crypto';

import { CalendarConflictError, PushJobData, PullJobData } from './calendar-sync-types.js';
import {
  handleGooglePush,
  pullGoogleIncremental,
  renewGoogleWatchChannel,
} from './calendar-sync-google.js';
import { handleMicrosoftPush, pullMicrosoftIncremental } from './calendar-sync-microsoft.js';

// ─── Exported queue/worker starters ───────────────────────────────────────

export async function startCalendarSync(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<{ pushQueue: Queue; pullQueue: Queue; watchQueue: Queue }> {
  const pushQueue = new Queue(CALENDAR_PUSH.name, {
    connection,
    defaultJobOptions: CALENDAR_PUSH.defaultJobOptions,
  });
  const pullQueue = new Queue(CALENDAR_PULL_INCREMENTAL.name, {
    connection,
    defaultJobOptions: CALENDAR_PULL_INCREMENTAL.defaultJobOptions,
  });
  const watchQueue = new Queue(CALENDAR_WATCH_RENEW.name, {
    connection,
    defaultJobOptions: CALENDAR_WATCH_RENEW.defaultJobOptions,
  });

  queues.push(pushQueue, pullQueue, watchQueue);

  // Schedule incremental pull every 2 minutes for all active integrations
  await pullQueue.add(
    'calendar.pull-incremental',
    { orgId: 'all', userId: 'all', integrationTokenId: 'all' },
    {
      repeat: { every: 2 * 60 * 1000 },
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86_400 },
    },
  );

  // Schedule Google watch channel renewal daily at 03:00 UTC
  await watchQueue.add(
    'calendar.watch-renew',
    { integrationTokenId: 'all' },
    {
      repeat: { pattern: '0 3 * * *' },
      removeOnComplete: { age: 86_400, count: 50 },
      removeOnFail: { age: 86_400 * 7 },
    },
  );

  // Push worker — processes events needing to be pushed/updated/deleted in provider
  const pushWorker = new Worker(
    CALENDAR_PUSH.name,
    async (job) => {
      const data = PushJobData.parse(job.data);
      const childLog = log.child({ job: job.name, jobId: job.id, ...data });

      const token = await prisma.integrationToken.findFirst({
        where: {
          orgId: data.orgId,
          userId: data.userId,
          status: 'active',
          deletedAt: null,
        },
      });

      if (!token) {
        childLog.warn('No active integration token found; skipping push');
        return;
      }

      const event = await prisma.calendarEvent.findFirst({
        where: { id: data.calendarEventId, orgId: data.orgId, deletedAt: null },
      });

      if (!event) {
        childLog.warn('CalendarEvent not found or deleted; skipping push');
        return;
      }

      try {
        const accessToken = decryptToken(token.accessTokenEncrypted);

        if (token.provider === 'google_workspace') {
          await handleGooglePush({
            event,
            operation: data.operation,
            accessToken,
            log: childLog,
          });
        } else if (token.provider === 'microsoft_graph') {
          await handleMicrosoftPush({
            event,
            operation: data.operation,
            accessToken,
            log: childLog,
          });
        }
      } catch (err: unknown) {
        const isConflict = err instanceof CalendarConflictError;
        if (isConflict) {
          // Mark as CONFLICT so the UI can surface it to the user
          await prisma.calendarEvent.update({
            where: { id: event.id },
            data: { syncState: 'CONFLICT' },
          });
          childLog.warn({ eventId: event.id }, 'Calendar push conflict — etag mismatch');
          return; // don't retry a conflict
        }
        throw err; // let BullMQ retry transient errors
      }
    },
    { connection, concurrency: 5 },
  );
  workers.push(pushWorker);

  // Incremental pull worker
  const pullWorker = new Worker(
    CALENDAR_PULL_INCREMENTAL.name,
    async (job) => {
      const raw = job.data as Record<string, unknown>;

      // Fan-out: if orgId === 'all', pull for all active integration tokens
      if (raw['orgId'] === 'all') {
        const tokens = await prisma.integrationToken.findMany({
          where: { status: 'active', deletedAt: null },
          select: { id: true, orgId: true, userId: true },
        });

        for (const t of tokens) {
          await job.updateProgress(0);
          const childLog = log.child({ tokenId: t.id, orgId: t.orgId, userId: t.userId });
          try {
            await runIncrementalPull(t.id, t.orgId, t.userId, childLog);
          } catch (err) {
            childLog.error({ err }, 'Incremental pull failed for token');
          }
        }
        return;
      }

      const data = PullJobData.parse(raw);
      const childLog = log.child({ ...data });
      await runIncrementalPull(data.integrationTokenId, data.orgId, data.userId, childLog);
    },
    { connection, concurrency: 3 },
  );
  workers.push(pullWorker);

  // Watch renewal worker (Google only)
  const watchWorker = new Worker(
    CALENDAR_WATCH_RENEW.name,
    async (job) => {
      const raw = job.data as Record<string, unknown>;

      const tokens = await prisma.integrationToken.findMany({
        where: {
          provider: 'google_workspace',
          status: 'active',
          deletedAt: null,
          ...(raw['integrationTokenId'] !== 'all'
            ? { id: raw['integrationTokenId'] as string }
            : {}),
        },
        select: {
          id: true,
          orgId: true,
          userId: true,
          accessTokenEncrypted: true,
          deltaState: true,
        },
      });

      for (const t of tokens) {
        const childLog = log.child({ tokenId: t.id });
        try {
          const deltaState = t.deltaState as Record<string, unknown>;
          const channelExpiry = deltaState['watchChannelExpiry'] as string | undefined;

          // Renew if expiry is within 24h
          const shouldRenew =
            !channelExpiry || new Date(channelExpiry).getTime() - Date.now() < 24 * 60 * 60 * 1000;

          if (!shouldRenew) {
            childLog.debug({ tokenId: t.id }, 'Watch channel still valid; skipping renewal');
            continue;
          }

          const accessToken = decryptToken(t.accessTokenEncrypted);
          await renewGoogleWatchChannel(t.orgId, t.id, accessToken, childLog);
        } catch (err) {
          childLog.error({ err, tokenId: t.id }, 'Watch channel renewal failed');
        }
      }
    },
    { connection, concurrency: 2 },
  );
  workers.push(watchWorker);

  log.info('Calendar sync workers started (push + pull-incremental + watch-renew)');
  return { pushQueue, pullQueue, watchQueue };
}

// ─── Incremental pull dispatcher ──────────────────────────────────────────

async function runIncrementalPull(
  tokenId: string,
  orgId: string,
  userId: string,
  log: pino.Logger,
): Promise<void> {
  // WHY findFirst + orgId in where (not findUnique by bare id): defense-in-depth —
  // callers pass ids from org-scoped fetches today, but the helper must not
  // decrypt a cross-tenant token if a future caller passes a mismatched pair.
  const token = await prisma.integrationToken.findFirst({ where: { id: tokenId, orgId } });
  if (!token || token.status !== 'active') return;

  const accessToken = decryptToken(token.accessTokenEncrypted);
  const deltaState = token.deltaState as Record<string, unknown>;

  if (token.provider === 'google_workspace') {
    await pullGoogleIncremental(token.id, orgId, userId, accessToken, deltaState, log);
  } else if (token.provider === 'microsoft_graph') {
    await pullMicrosoftIncremental(token.id, orgId, userId, accessToken, deltaState, log);
  }
}
