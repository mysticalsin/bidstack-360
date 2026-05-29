// Google Calendar push, incremental pull, and watch channel renewal.

import { randomUUID } from 'node:crypto';

import type pino from 'pino';

import { prisma } from '@bidstack/db';

import { CalendarConflictError } from './calendar-sync-types.js';
import type { PushParams } from './calendar-sync-types.js';

// ─── Google push ───────────────────────────────────────────────────────────

export async function handleGooglePush({
  event,
  operation,
  accessToken,
  log,
}: PushParams): Promise<void> {
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

// ─── Google incremental pull ───────────────────────────────────────────────

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

export async function pullGoogleIncremental(
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

// ─── Google watch channel renewal ─────────────────────────────────────────

export async function renewGoogleWatchChannel(
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
