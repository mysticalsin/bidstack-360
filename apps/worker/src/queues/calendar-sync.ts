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

// ─── Scheduling / fan-out constants ────────────────────────────────────────

const PULL_REPEAT_EVERY_MS = 2 * 60 * 1000;
const WATCH_REPEAT_EVERY_MS = 24 * 60 * 60 * 1000;
const PUSH_SWEEP_EVERY_MS = 30 * 60 * 1000;

/** Bounded page size so a single fan-out tick never loads every token/event at once. */
const FANOUT_BATCH_SIZE = 200;

// A row still PENDING_PUSH this long after its last write is stranded (POST-before-
// commit crash). Well past the ~21s retry window and far under the 24h claim TTL.
const PUSH_STRANDED_AFTER_MS = 30 * 60 * 1000;

const PUSH_SWEEP_JOB = 'calendar.push-sweep';

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

  // Schedule the stranded-push recovery sweep every 30 min (see sweepStrandedPushes).
  await pushQueue.add(
    PUSH_SWEEP_JOB,
    {},
    {
      jobId: 'calendar-push-sweep-cron',
      repeat: { every: PUSH_SWEEP_EVERY_MS },
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86_400 },
    },
  );

  // Push worker — processes events needing to be pushed/updated/deleted in provider
  const pushWorker = new Worker(
    CALENDAR_PUSH.name,
    async (job) => {
      if (job.name === PUSH_SWEEP_JOB) {
        await sweepStrandedPushes(pushQueue, log);
        return;
      }

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
            connection,
            jobId: String(job.id),
            log: childLog,
          });
        } else if (token.provider === 'microsoft_graph') {
          await handleMicrosoftPush({
            event,
            operation: data.operation,
            accessToken,
            connection,
            jobId: String(job.id),
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

      // Fan-out tick: enqueue bounded per-token pull jobs and return, never loop
      // every token inline (that would overrun the 2-min interval at scale).
      if (raw['orgId'] === 'all') {
        await fanoutIncrementalPulls(pullQueue, log);
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

      // Fan-out tick: enqueue bounded per-token renewal jobs, never loop inline.
      if (raw['integrationTokenId'] === 'all') {
        await fanoutWatchRenewals(watchQueue, log);
        return;
      }

      await renewWatchForToken(raw['integrationTokenId'] as string, log);
    },
    { connection, concurrency: 2 },
  );
  workers.push(watchWorker);

  log.info('Calendar sync workers started (push + pull-incremental + watch-renew)');
  return { pushQueue, pullQueue, watchQueue };
}

// ─── Fan-out dispatchers (bounded, cursor-paginated) ──────────────────────

/**
 * Fan out the incremental-pull tick: cursor-paginate active tokens in bounded
 * batches and enqueue ONE per-token pull job each. Keeps the tick inside its 2-min
 * window even at 100k+ tokens — heavy decrypt + provider I/O runs in bounded jobs
 * drained by worker concurrency, not one ever-growing inline loop that overlaps the
 * next tick. Mirrors dust-poll.ts fanoutOrgPolls; window-bucketed jobIds dedup ticks.
 */
export async function fanoutIncrementalPulls(queue: Queue, log: pino.Logger): Promise<void> {
  const windowBucket = Math.floor(Date.now() / PULL_REPEAT_EVERY_MS);
  let cursor: string | undefined;
  let dispatched = 0;

  while (true) {
    const batch = await prisma.integrationToken.findMany({
      where: { status: 'active', deletedAt: null },
      select: { id: true, orgId: true, userId: true },
      take: FANOUT_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (batch.length === 0) break;

    for (const t of batch) {
      await queue.add(
        'calendar.pull-incremental',
        { orgId: t.orgId, userId: t.userId, integrationTokenId: t.id },
        { jobId: `calendar-pull:${t.id}:${windowBucket}` },
      );
      dispatched++;
    }

    cursor = batch[batch.length - 1]!.id;
    if (batch.length < FANOUT_BATCH_SIZE) break;
  }

  log.info({ dispatched, windowBucket }, 'calendar.pull-incremental fanout dispatched');
}

/** Fan out the daily watch-renewal tick: bounded, cursor-paginated per-token jobs. */
export async function fanoutWatchRenewals(queue: Queue, log: pino.Logger): Promise<void> {
  const windowBucket = Math.floor(Date.now() / WATCH_REPEAT_EVERY_MS);
  let cursor: string | undefined;
  let dispatched = 0;

  while (true) {
    const batch = await prisma.integrationToken.findMany({
      where: { provider: 'google_workspace', status: 'active', deletedAt: null },
      select: { id: true },
      take: FANOUT_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (batch.length === 0) break;

    for (const t of batch) {
      await queue.add(
        'calendar.watch-renew',
        { integrationTokenId: t.id },
        { jobId: `calendar-watch:${t.id}:${windowBucket}` },
      );
      dispatched++;
    }

    cursor = batch[batch.length - 1]!.id;
    if (batch.length < FANOUT_BATCH_SIZE) break;
  }

  log.info({ dispatched, windowBucket }, 'calendar.watch-renew fanout dispatched');
}

/** Renew the Google watch channel for a single token (per-token fan-out job). */
async function renewWatchForToken(tokenId: string, log: pino.Logger): Promise<void> {
  const token = await prisma.integrationToken.findFirst({
    where: { id: tokenId, provider: 'google_workspace', status: 'active', deletedAt: null },
    select: { id: true, orgId: true, accessTokenEncrypted: true, deltaState: true },
  });
  if (!token) return;

  const childLog = log.child({ tokenId: token.id });
  try {
    const deltaState = token.deltaState as Record<string, unknown>;
    const channelExpiry = deltaState['watchChannelExpiry'] as string | undefined;

    // Renew if expiry is within 24h
    const shouldRenew =
      !channelExpiry || new Date(channelExpiry).getTime() - Date.now() < 24 * 60 * 60 * 1000;

    if (!shouldRenew) {
      childLog.debug({ tokenId: token.id }, 'Watch channel still valid; skipping renewal');
      return;
    }

    const accessToken = decryptToken(token.accessTokenEncrypted);
    await renewGoogleWatchChannel(token.orgId, token.id, accessToken, childLog);
  } catch (err) {
    childLog.error({ err, tokenId: token.id }, 'Watch channel renewal failed');
  }
}

// ─── Stranded-push recovery sweep ─────────────────────────────────────────

/**
 * Recover events stranded in PENDING_PUSH by a worker crash between the provider
 * POST and the DB commit: the claim key survives as 'pending', so BullMQ's
 * stalled-job retry (same jobId) hits it, skips the re-POST, and completes,
 * leaving the event unsent forever (nothing else scans stuck PENDING_PUSH rows).
 * Re-enqueue a FRESH calendar.push job — a new jobId mints a new claim key, so the
 * recovery attempt owns the create and re-POSTs, exactly like a user re-edit would.
 * Narrowed to locally-created rows (externalId:null, not soft-deleted): update/delete
 * crashes self-heal via BullMQ retry (no create claim held), so the re-enqueued
 * 'push' can never duplicate an already-created provider event. Window-bucketed
 * jobIds dedup overlapping sweeps and never collide with the stranded claim.
 */
export async function sweepStrandedPushes(queue: Queue, log: pino.Logger): Promise<void> {
  const now = Date.now();
  const windowBucket = Math.floor(now / PUSH_SWEEP_EVERY_MS);
  const staleBefore = new Date(now - PUSH_STRANDED_AFTER_MS);
  let cursor: string | undefined;
  let recovered = 0;

  while (true) {
    const batch = await prisma.calendarEvent.findMany({
      where: {
        syncState: 'PENDING_PUSH',
        externalId: null,
        deletedAt: null,
        updatedAt: { lt: staleBefore },
      },
      select: { id: true, orgId: true, ownerId: true },
      take: FANOUT_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (batch.length === 0) break;

    for (const e of batch) {
      await queue.add(
        'calendar.push',
        { orgId: e.orgId, userId: e.ownerId, calendarEventId: e.id, operation: 'push' },
        { jobId: `calendar-push-sweep:${e.id}:${windowBucket}` },
      );
      recovered++;
    }

    cursor = batch[batch.length - 1]!.id;
    if (batch.length < FANOUT_BATCH_SIZE) break;
  }

  if (recovered > 0) {
    log.warn({ recovered, windowBucket }, 'calendar push sweep re-enqueued stranded events');
  }
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
