// Microsoft Graph Calendar push, incremental pull, and event upsert.

import type pino from 'pino';

import { prisma } from '@bidstack/db';

import { CalendarConflictError } from './calendar-sync-types.js';
import type { PushParams } from './calendar-sync-types.js';

// ─── Microsoft push ────────────────────────────────────────────────────────

export async function handleMicrosoftPush({
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

// ─── Microsoft incremental pull ────────────────────────────────────────────

export async function pullMicrosoftIncremental(
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
