/**
 * Outlook email sync worker.
 *
 * Three job types processed here:
 *
 *  email.outlook.pull-incremental
 *    - Triggered by Graph webhook notification (near-real-time) OR
 *    - Scheduled every 5 min as fallback poll for each active token.
 *    - Uses @odata.deltaLink stored in IntegrationToken.deltaState.
 *    - Respects Retry-After on 429 by moving the job to delayed state.
 *
 *  email.outlook.pull-historical
 *    - Enqueued once on first connect (after OAuth callback).
 *    - Resets deltaLink then pulls full inbox (last ~100 messages).
 *
 *  email.outlook.subscription-renew  (cron: daily at 02:00 UTC)
 *    - Queries GraphSubscription rows expiring within 26 h.
 *    - Calls renewSubscription() for each, handles recreate-on-404.
 *    - Idempotent: safe to run multiple times.
 *
 * WHY service functions are duplicated here instead of imported from apps/api:
 * Cross-app imports create circular build dependencies (apps/worker depends on
 * apps/api compilation artifact). The Graph-call logic is re-implemented using
 * @bidstack/db (prisma) and @bidstack/shared (crypto). If this diverges too far,
 * extract to a @bidstack/email-sync package.
 */

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { decryptToken, encryptToken } from '@bidstack/shared';
import {
  OUTLOOK_PULL_INCREMENTAL,
  OUTLOOK_PULL_HISTORICAL,
  OUTLOOK_SUBSCRIPTION_RENEW,
} from '@bidstack/shared';

// ─── Job data schemas ──────────────────────────────────────────────────────

const PullJobData = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  integrationTokenId: z.string().uuid(),
});

// ─── Typed error for rate-limit signalling ─────────────────────────────────

class RateLimitError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`Graph 429 — retry after ${retryAfterMs}ms`);
    this.retryAfterMs = retryAfterMs;
  }
}

// ─── Token helpers ─────────────────────────────────────────────────────────

function tenant(): string {
  return process.env.MICROSOFT_TENANT_ID ?? 'common';
}
function graphClientId(): string {
  return process.env.MICROSOFT_GRAPH_CLIENT_ID ?? '';
}
function graphClientSecret(): string {
  return process.env.MICROSOFT_GRAPH_CLIENT_SECRET ?? '';
}

async function refreshMsGraphToken(
  tokenId: string,
  refreshToken: string,
  log: pino.Logger,
): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: graphClientId(),
        client_secret: graphClientSecret(),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: [
          'https://graph.microsoft.com/Mail.Send',
          'https://graph.microsoft.com/Mail.Read',
          'offline_access',
        ].join(' '),
      }).toString(),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    log.error({ tokenId, status: res.status, body }, 'MS Graph token refresh failed');
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: { status: 'error', errorMessage: `refresh_failed:${res.status}` },
    });
    throw new Error(`MS Graph token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : undefined;

  await prisma.integrationToken.update({
    where: { id: tokenId },
    data: {
      accessTokenEncrypted: encryptToken(data.access_token),
      ...(data.refresh_token
        ? { refreshTokenEncrypted: encryptToken(data.refresh_token) }
        : {}),
      expiresAt,
      status: 'active',
      lastRefreshedAt: new Date(),
      errorMessage: null,
    },
  });

  return data.access_token;
}

async function getAccessToken(
  row: { id: string; accessTokenEncrypted: string; refreshTokenEncrypted: string | null; expiresAt: Date | null },
  log: pino.Logger,
): Promise<string> {
  const isExpired = row.expiresAt
    ? row.expiresAt.getTime() < Date.now() + 60_000
    : false;

  if (!isExpired) return decryptToken(row.accessTokenEncrypted);
  if (!row.refreshTokenEncrypted) throw new Error('Token expired — no refresh token');

  return refreshMsGraphToken(row.id, decryptToken(row.refreshTokenEncrypted), log);
}

// ─── Delta pull ─────────────────────────────────────────────────────────────

const DELTA_SELECT = 'id,conversationId,from,toRecipients,ccRecipients,subject,receivedDateTime,sentDateTime,isDraft,body';
const INITIAL_DELTA_URL = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top=100&$select=${DELTA_SELECT}`;

async function pullDelta(
  params: { orgId: string; userId: string; integrationTokenId: string },
  log: pino.Logger,
): Promise<{ persisted: number }> {
  const token = await prisma.integrationToken.findUnique({
    where: { id: params.integrationTokenId },
  });

  if (!token || token.orgId !== params.orgId || token.status !== 'active') {
    log.warn({ tokenId: params.integrationTokenId }, 'Skipping Graph pull: token inactive');
    return { persisted: 0 };
  }

  const accessToken = await getAccessToken(token, log);
  const deltaState = (token.deltaState ?? {}) as Record<string, unknown>;
  const startUrl = (deltaState.mailDeltaLink as string | undefined) ?? INITIAL_DELTA_URL;

  const res = await fetch(startUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const retryAfterMs = retryAfter ? parseInt(retryAfter) * 1_000 : 60_000;
    throw new RateLimitError(retryAfterMs);
  }

  if (res.status === 410) {
    log.warn({ tokenId: token.id }, 'Graph deltaLink expired (410); resetting');
    await prisma.integrationToken.update({
      where: { id: token.id },
      data: { deltaState: {} },
    });
    return { persisted: 0 };
  }

  if (!res.ok) {
    log.error({ status: res.status, tokenId: token.id }, 'Graph delta query failed');
    throw new Error(`Graph delta query failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    value?: Array<{
      id: string;
      conversationId?: string;
      from?: { emailAddress?: { address?: string; name?: string } };
      toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
      ccRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
      subject?: string;
      receivedDateTime?: string;
      sentDateTime?: string;
      isDraft?: boolean;
      body?: { content?: string; contentType?: string };
    }>;
    '@odata.deltaLink'?: string;
  };

  let persisted = 0;
  const accountEmail = token.externalAccountEmail ?? '';

  for (const msg of (data.value ?? [])) {
    if (msg.isDraft) continue;

    try {
      const fromEmail = msg.from?.emailAddress?.address ?? '';
      const toEmails = (msg.toRecipients ?? []).map((r) => ({
        email: r.emailAddress?.address ?? '',
        name: r.emailAddress?.name,
      }));
      const ccEmails = (msg.ccRecipients ?? []).map((r) => ({
        email: r.emailAddress?.address ?? '',
        name: r.emailAddress?.name,
      }));

      const contact = await prisma.contact.findFirst({
        where: { orgId: params.orgId, email: fromEmail, deletedAt: null },
        select: { id: true },
      });

      await prisma.emailMessage.upsert({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          email_messages_org_external_key: { orgId: params.orgId, externalMessageId: msg.id } as any,
        },
        create: {
          orgId: params.orgId,
          userId: params.userId,
          integrationTokenId: params.integrationTokenId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'OUTLOOK' as any,
          externalMessageId: msg.id,
          threadId: msg.conversationId ?? null,
          fromEmail,
          toEmails,
          ccEmails,
          subject: msg.subject ?? '',
          bodyHtml: msg.body?.contentType === 'html' ? (msg.body.content ?? null) : null,
          bodyText: msg.body?.contentType === 'text' ? (msg.body.content ?? null) : null,
          receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
          sentAt: msg.sentDateTime ? new Date(msg.sentDateTime) : null,
          isOutbound: fromEmail.toLowerCase() === accountEmail.toLowerCase(),
          entityType: contact ? 'contact' : null,
          entityId: contact?.id ?? null,
        },
        update: {},
      });

      persisted++;
    } catch (err) {
      log.warn({ err, msgId: msg.id }, 'Failed to persist Graph message');
    }
  }

  if (data['@odata.deltaLink']) {
    await prisma.integrationToken.update({
      where: { id: token.id },
      data: {
        deltaState: { mailDeltaLink: data['@odata.deltaLink'] },
        lastSyncedAt: new Date(),
      },
    });
  }

  return { persisted };
}

// ─── Subscription renewal ──────────────────────────────────────────────────

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SUB_MAX_MS = 3 * 24 * 60 * 60 * 1_000;

async function renewSub(subscriptionId: string, log: pino.Logger): Promise<void> {
  const sub = await prisma.graphSubscription.findUnique({
    where: { subscriptionId },
    include: { integrationToken: true },
  });

  if (!sub) {
    log.warn({ subscriptionId }, 'Cannot renew: subscription not found locally');
    return;
  }

  const accessToken = await getAccessToken(sub.integrationToken, log);
  const newExpiry = new Date(Date.now() + SUB_MAX_MS);

  const res = await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expirationDateTime: newExpiry.toISOString() }),
  });

  if (res.status === 404) {
    log.warn({ subscriptionId }, 'Graph subscription 404 on renew; deleting local row');
    await prisma.graphSubscription.deleteMany({ where: { subscriptionId } });
    return;
  }

  if (!res.ok) {
    log.error({ status: res.status, subscriptionId }, 'Graph subscription renewal failed');
    throw new Error(`Subscription renewal failed: ${res.status}`);
  }

  await prisma.graphSubscription.update({
    where: { subscriptionId },
    data: { expiresAt: newExpiry, renewalCount: { increment: 1 } },
  });

  log.info({ subscriptionId, newExpiry }, 'Graph subscription renewed');
}

// ─── Worker factory ────────────────────────────────────────────────────────

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
        // Fan-out: enqueue one pull job per active Outlook token
        const tokens = await prisma.integrationToken.findMany({
          where: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            provider: 'microsoft_graph' as any,
            status: 'active',
            deletedAt: null,
          },
          select: { id: true, orgId: true, userId: true },
        });

        for (const token of tokens) {
          await pullQueue.add(
            OUTLOOK_PULL_INCREMENTAL.name,
            { orgId: token.orgId, userId: token.userId, integrationTokenId: token.id },
            {
              // Dedup within the current 1-minute window
              jobId: `incremental-${token.id}-${Math.floor(Date.now() / 60_000)}`,
            },
          );
        }

        log.info({ count: tokens.length }, 'outlook pull fanout dispatched');
        return;
      }

      const data = PullJobData.parse(job.data);
      log.info({ jobId: job.id, orgId: data.orgId }, 'outlook pull-incremental start');

      try {
        const { persisted } = await pullDelta(data, log);
        log.info({ jobId: job.id, persisted }, 'outlook pull-incremental complete');
      } catch (err) {
        if (err instanceof RateLimitError) {
          log.warn({ jobId: job.id, delayMs: err.retryAfterMs }, 'Graph 429 — delaying job');
          await job.moveToDelayed(Date.now() + err.retryAfterMs, job.token);
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

      // Reset delta link to force full pull
      await prisma.integrationToken.update({
        where: { id: data.integrationTokenId },
        data: { deltaState: {} },
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
