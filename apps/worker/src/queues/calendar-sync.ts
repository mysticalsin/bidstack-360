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
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import { CALENDAR_PUSH, CALENDAR_PULL_INCREMENTAL, CALENDAR_WATCH_RENEW } from '@bidstack/shared';
import { decryptToken } from '@bidstack/shared/token-crypto';

// ─── Job data schemas ──────────────────────────────────────────────────────

const PushJobData = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  calendarEventId: z.string().uuid(),
  /** push | update | delete */
  operation: z.enum(['push', 'update', 'delete']),
});

const PullJobData = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  integrationTokenId: z.string().uuid(),
});

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
          await renewGoogleWatchChannel(t.id, accessToken, childLog);
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

// ─── Google push ───────────────────────────────────────────────────────────

interface PushParams {
  event: {
    id: string;
    orgId: string;
    externalId: string | null;
    subject: string;
    bodyPreview: string | null;
    startAt: Date;
    endAt: Date;
    location: string | null;
    attendees: unknown;
    etag: string | null;
  };
  operation: 'push' | 'update' | 'delete';
  accessToken: string;
  log: pino.Logger;
}

async function handleGooglePush({ event, operation, accessToken, log }: PushParams): Promise<void> {
  const baseUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const body = {
    summary: event.subject,
    description: event.bodyPreview ?? undefined,
    start: { dateTime: event.startAt.toISOString() },
    end: { dateTime: event.endAt.toISOString() },
    location: event.location ?? undefined,
    attendees: Array.isArray(event.attendees)
      ? (event.attendees as Array<{ email: string; displayName?: string }>).map((a) => ({
          email: a.email,
          displayName: a.displayName,
        }))
      : [],
  };

  if (operation === 'push') {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      log.error({ status: res.status, body: text }, 'Google calendar create failed');
      throw new Error(`Google create failed: ${res.status}`);
    }
    const json = (await res.json()) as { id: string; etag: string };
    await prisma.calendarEvent.update({
      where: { id: event.id },
      data: {
        externalId: json.id,
        etag: json.etag,
        syncState: 'SYNCED',
        lastSyncedAt: new Date(),
      },
    });
    log.info({ eventId: event.id, googleId: json.id }, 'Created event in Google Calendar');
  } else if (operation === 'update') {
    if (!event.externalId) {
      log.warn(
        { eventId: event.id },
        'Update requested but externalId is null; re-queuing as push',
      );
      await prisma.calendarEvent.update({
        where: { id: event.id },
        data: { syncState: 'PENDING_PUSH' },
      });
      return;
    }
    const res = await fetch(`${baseUrl}/${event.externalId}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        // WHY: If-Match prevents overwriting a provider-side edit (etag mismatch = 412)
        ...(event.etag ? { 'If-Match': event.etag } : {}),
      },
      body: JSON.stringify(body),
    });
    if (res.status === 412) {
      throw new CalendarConflictError('Google etag mismatch');
    }
    if (!res.ok) throw new Error(`Google update failed: ${res.status}`);
    const json = (await res.json()) as { etag: string };
    await prisma.calendarEvent.update({
      where: { id: event.id },
      data: { etag: json.etag, syncState: 'SYNCED', lastSyncedAt: new Date() },
    });
  } else if (operation === 'delete') {
    if (!event.externalId) return; // never pushed, nothing to delete
    const res = await fetch(`${baseUrl}/${event.externalId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`Google delete failed: ${res.status}`);
    }
    await prisma.calendarEvent.update({
      where: { id: event.id },
      data: { syncState: 'SYNCED', deletedAt: new Date() },
    });
  }
}

// ─── Microsoft push ────────────────────────────────────────────────────────

async function handleMicrosoftPush({
  event,
  operation,
  accessToken,
  log,
}: PushParams): Promise<void> {
  const baseUrl = 'https://graph.microsoft.com/v1.0/me/events';
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Prefer: 'IdType="ImmutableId"',
  };

  const body = {
    subject: event.subject,
    body: { contentType: 'text', content: event.bodyPreview ?? '' },
    start: { dateTime: event.startAt.toISOString(), timeZone: 'UTC' },
    end: { dateTime: event.endAt.toISOString(), timeZone: 'UTC' },
    location: event.location ? { displayName: event.location } : undefined,
    attendees: Array.isArray(event.attendees)
      ? (event.attendees as Array<{ email: string; displayName?: string }>).map((a) => ({
          emailAddress: { address: a.email, name: a.displayName ?? a.email },
          type: 'required',
        }))
      : [],
  };

  if (operation === 'push') {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`MS Graph create failed: ${res.status}`);
    const json = (await res.json()) as { id: string; '@odata.etag': string };
    await prisma.calendarEvent.update({
      where: { id: event.id },
      data: {
        externalId: json.id,
        etag: json['@odata.etag'],
        syncState: 'SYNCED',
        lastSyncedAt: new Date(),
      },
    });
    log.info({ eventId: event.id, msId: json.id }, 'Created event in MS Calendar');
  } else if (operation === 'update') {
    if (!event.externalId) return;
    const res = await fetch(`${baseUrl}/${event.externalId}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        ...(event.etag ? { 'If-Match': event.etag } : {}),
      },
      body: JSON.stringify(body),
    });
    if (res.status === 412) throw new CalendarConflictError('MS Graph etag mismatch');
    if (!res.ok) throw new Error(`MS Graph update failed: ${res.status}`);
    const json = (await res.json()) as { '@odata.etag': string };
    await prisma.calendarEvent.update({
      where: { id: event.id },
      data: { etag: json['@odata.etag'], syncState: 'SYNCED', lastSyncedAt: new Date() },
    });
  } else if (operation === 'delete') {
    if (!event.externalId) return;
    const res = await fetch(`${baseUrl}/${event.externalId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok && res.status !== 404) throw new Error(`MS Graph delete failed: ${res.status}`);
    await prisma.calendarEvent.update({
      where: { id: event.id },
      data: { syncState: 'SYNCED', deletedAt: new Date() },
    });
  }
}

// ─── Incremental pull logic ────────────────────────────────────────────────

async function runIncrementalPull(
  tokenId: string,
  orgId: string,
  userId: string,
  log: pino.Logger,
): Promise<void> {
  const token = await prisma.integrationToken.findUnique({ where: { id: tokenId } });
  if (!token || token.status !== 'active') return;

  const accessToken = decryptToken(token.accessTokenEncrypted);
  const deltaState = token.deltaState as Record<string, unknown>;

  if (token.provider === 'google_workspace') {
    await pullGoogleIncremental(token.id, orgId, userId, accessToken, deltaState, log);
  } else if (token.provider === 'microsoft_graph') {
    await pullMicrosoftIncremental(token.id, orgId, userId, accessToken, deltaState, log);
  }
}

async function pullGoogleIncremental(
  tokenId: string,
  orgId: string,
  userId: string,
  accessToken: string,
  deltaState: Record<string, unknown>,
  log: pino.Logger,
): Promise<void> {
  const syncToken = deltaState['calendarSyncToken'] as string | undefined;
  let url: string;

  if (syncToken) {
    url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?syncToken=${encodeURIComponent(syncToken)}`;
  } else {
    // Full sync on first run: last 30 days
    const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true`;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 410) {
    // Sync token expired — clear and retry full sync next iteration
    log.warn({ tokenId }, 'Google sync token expired; clearing for full re-sync');
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: { deltaState: {}, updatedAt: new Date() },
    });
    return;
  }

  if (!res.ok) throw new Error(`Google events list failed: ${res.status}`);

  const body = (await res.json()) as {
    items?: GoogleEventItem[];
    nextSyncToken?: string;
    nextPageToken?: string;
  };

  const items = body.items ?? [];
  await upsertGoogleEvents(items, orgId, userId, log);

  const newSyncToken = body.nextSyncToken;
  if (newSyncToken) {
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: {
        deltaState: { ...deltaState, calendarSyncToken: newSyncToken },
        lastSyncedAt: new Date(),
      },
    });
  }

  log.debug({ tokenId, count: items.length }, 'Google incremental pull complete');
}

interface GoogleEventItem {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  organizer?: { email?: string };
  updated?: string;
  etag?: string;
}

async function upsertGoogleEvents(
  items: GoogleEventItem[],
  orgId: string,
  userId: string,
  log: pino.Logger,
): Promise<void> {
  for (const item of items) {
    if (!item.id) continue;

    const isCancelled = item.status === 'cancelled';

    if (isCancelled) {
      // Soft-delete or mark DELETED_REMOTE so the UI can show a tombstone
      await prisma.calendarEvent.updateMany({
        where: { provider: 'google_workspace', externalId: item.id, orgId },
        data: { syncState: 'DELETED_REMOTE', isCancelled: true },
      });
      continue;
    }

    const startAt = new Date(item.start?.dateTime ?? item.start?.date ?? Date.now());
    const endAt = new Date(item.end?.dateTime ?? item.end?.date ?? Date.now());
    const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);

    try {
      await prisma.calendarEvent.upsert({
        where: {
          provider_externalId: { provider: 'google_workspace', externalId: item.id },
        } as Parameters<typeof prisma.calendarEvent.upsert>[0]['where'],
        create: {
          orgId,
          ownerId: userId,
          externalId: item.id,
          provider: 'google_workspace',
          subject: item.summary ?? '(No title)',
          bodyPreview: item.description?.slice(0, 500) ?? null,
          startAt,
          endAt,
          location: item.location ?? null,
          isAllDay,
          isCancelled: false,
          attendees: item.attendees ?? [],
          organizerEmail: item.organizer?.email ?? null,
          externalUpdatedAt: item.updated ? new Date(item.updated) : null,
          etag: item.etag ?? null,
          syncState: 'SYNCED',
          lastSyncedAt: new Date(),
        },
        update: {
          subject: item.summary ?? '(No title)',
          bodyPreview: item.description?.slice(0, 500) ?? null,
          startAt,
          endAt,
          location: item.location ?? null,
          isAllDay,
          attendees: item.attendees ?? [],
          externalUpdatedAt: item.updated ? new Date(item.updated) : null,
          etag: item.etag ?? null,
          syncState: 'SYNCED',
          lastSyncedAt: new Date(),
        },
      });
    } catch (err) {
      log.warn({ err, eventId: item.id }, 'Failed to upsert Google event; skipping');
    }
  }
}

async function pullMicrosoftIncremental(
  tokenId: string,
  orgId: string,
  userId: string,
  accessToken: string,
  deltaState: Record<string, unknown>,
  log: pino.Logger,
): Promise<void> {
  const deltaLink = deltaState['calendarDeltaLink'] as string | undefined;
  const url =
    deltaLink ??
    'https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime=' +
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() +
      '&endDateTime=' +
      new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'odata.maxpagesize=50',
    },
  });

  if (!res.ok) throw new Error(`MS Graph delta failed: ${res.status}`);

  const body = (await res.json()) as {
    value?: MsGraphEventItem[];
    '@odata.deltaLink'?: string;
  };

  const items = body.value ?? [];
  await upsertMicrosoftEvents(items, orgId, userId, log);

  if (body['@odata.deltaLink']) {
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: {
        deltaState: { ...deltaState, calendarDeltaLink: body['@odata.deltaLink'] },
        lastSyncedAt: new Date(),
      },
    });
  }

  log.debug({ tokenId, count: items.length }, 'MS Graph incremental pull complete');
}

interface MsGraphEventItem {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  attendees?: Array<{
    emailAddress: { address: string; name?: string };
    status?: { response?: string };
  }>;
  organizer?: { emailAddress?: { address?: string } };
  lastModifiedDateTime?: string;
  '@odata.etag'?: string;
  '@removed'?: { reason?: string };
}

async function upsertMicrosoftEvents(
  items: MsGraphEventItem[],
  orgId: string,
  userId: string,
  log: pino.Logger,
): Promise<void> {
  for (const item of items) {
    if (!item.id) continue;

    if (item['@removed']) {
      await prisma.calendarEvent.updateMany({
        where: { provider: 'microsoft_graph', externalId: item.id, orgId },
        data: { syncState: 'DELETED_REMOTE', isCancelled: true },
      });
      continue;
    }

    const startAt = new Date(item.start?.dateTime ?? Date.now());
    const endAt = new Date(item.end?.dateTime ?? Date.now());

    try {
      const attendees = (item.attendees ?? []).map((a) => ({
        email: a.emailAddress.address,
        displayName: a.emailAddress.name,
        responseStatus: a.status?.response,
      }));

      await prisma.calendarEvent.upsert({
        where: {
          provider_externalId: { provider: 'microsoft_graph', externalId: item.id },
        } as Parameters<typeof prisma.calendarEvent.upsert>[0]['where'],
        create: {
          orgId,
          ownerId: userId,
          externalId: item.id,
          provider: 'microsoft_graph',
          subject: item.subject ?? '(No title)',
          bodyPreview: item.bodyPreview?.slice(0, 500) ?? null,
          startAt,
          endAt,
          location: item.location?.displayName ?? null,
          isAllDay: item.isAllDay ?? false,
          isCancelled: item.isCancelled ?? false,
          attendees,
          organizerEmail: item.organizer?.emailAddress?.address ?? null,
          externalUpdatedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
          etag: item['@odata.etag'] ?? null,
          syncState: 'SYNCED',
          lastSyncedAt: new Date(),
        },
        update: {
          subject: item.subject ?? '(No title)',
          bodyPreview: item.bodyPreview?.slice(0, 500) ?? null,
          startAt,
          endAt,
          location: item.location?.displayName ?? null,
          isAllDay: item.isAllDay ?? false,
          isCancelled: item.isCancelled ?? false,
          attendees,
          externalUpdatedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
          etag: item['@odata.etag'] ?? null,
          syncState: 'SYNCED',
          lastSyncedAt: new Date(),
        },
      });
    } catch (err) {
      log.warn({ err, eventId: item.id }, 'Failed to upsert MS event; skipping');
    }
  }
}

// ─── Google watch channel renewal ─────────────────────────────────────────

async function renewGoogleWatchChannel(
  tokenId: string,
  accessToken: string,
  log: pino.Logger,
): Promise<void> {
  const channelId = randomUUID();
  const webhookUrl = process.env.GOOGLE_CALENDAR_WEBHOOK_URL ?? '';

  if (!webhookUrl) {
    log.warn('GOOGLE_CALENDAR_WEBHOOK_URL not set; skipping watch channel creation');
    return;
  }

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events/watch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days in ms
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    log.error({ status: res.status, body: text, tokenId }, 'Watch channel creation failed');
    return;
  }

  const json = (await res.json()) as { id: string; expiration: string };

  await prisma.integrationToken.update({
    where: { id: tokenId },
    data: {
      deltaState: {
        watchChannelId: json.id,
        watchChannelExpiry: new Date(Number(json.expiration)).toISOString(),
      },
    },
  });

  log.info({ tokenId, channelId: json.id }, 'Google watch channel renewed');
}

// ─── Error types ───────────────────────────────────────────────────────────

class CalendarConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarConflictError';
  }
}
