// Microsoft Graph Calendar push, incremental pull, and event upsert.

import type pino from 'pino';

import { prisma, syncCalendarEventActivity } from '@bidstack/db';
import { graphEventTime } from '@bidstack/shared';

import {
  claimCalendarPush,
  recordCalendarPushClaim,
  releaseCalendarPushClaim,
} from './calendar-sync-claim.js';
import { CalendarConflictError } from './calendar-sync-types.js';
import type { PushParams } from './calendar-sync-types.js';

import {
  bridgeActivity,
  calendarFiling,
  graphMeetingHints,
  refileUnlessManual,
  resolveCaptureTarget,
  type GraphMeetingFields,
} from '../lib/comms-capture.js';
import { providerFetch } from '../lib/provider-http.js';
import { assertSerumConnectorAllowed } from '../lib/serum-connector-policy.js';

// ─── Microsoft push ────────────────────────────────────────────────────────

export async function handleMicrosoftPush({
  event,
  operation,
  accessToken,
  connection,
  jobId,
  log,
}: PushParams): Promise<void> {
  await assertSerumConnectorAllowed({
    orgId: event.orgId,
    connectorId: 'microsoft_graph',
    operation: `calendar.${operation}`,
    writeRequested: true,
  });

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
    // Idempotency: the POST precedes the DB commit of externalId, so a BullMQ
    // retry after a crash between them would create a duplicate provider event.
    // Claim a per-job key BEFORE posting; a prior attempt that already created
    // will have set it, so we skip the re-create (see calendar-sync-claim.ts).
    if (!(await claimCalendarPush(connection, jobId, event.id, log))) return;
    let json: { id: string; '@odata.etag': string };
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`MS Graph create failed: ${res.status}`);
      json = (await res.json()) as { id: string; '@odata.etag': string };
    } catch (err) {
      // MS Graph never accepted — release the claim so a legitimate retry can re-create.
      await releaseCalendarPushClaim(connection, jobId);
      throw err;
    }
    // Record the external id in the claim BEFORE the DB write so a crash here still blocks a re-create.
    await recordCalendarPushClaim(connection, jobId, { id: json.id, etag: json['@odata.etag'] });
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
    // The API soft-deleted the row before enqueueing; the explicit deletedAt
    // filter reaches past the soft-delete middleware.
    await prisma.calendarEvent.updateMany({
      where: { id: event.id, deletedAt: { not: null } },
      data: { syncState: 'SYNCED' },
    });
  }
}

// ─── Microsoft incremental pull ────────────────────────────────────────────

const MAX_PAGES_PER_RUN = 20;

const GRAPH_READ_HEADERS = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  // UTC wall times, so parsing never depends on the worker's local zone.
  Prefer: 'odata.maxpagesize=50, outlook.timezone="UTC"',
});

function initialDeltaUrl(now = Date.now()): string {
  const from = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
  return `https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime=${from}&endDateTime=${to}`;
}

/**
 * Pull changed events with the calendarView delta query, following every
 * nextLink page until Graph hands back a deltaLink. A run that hits the page
 * cap stores the nextLink and resumes from it on the next tick.
 */
export async function pullMicrosoftIncremental(
  tokenId: string,
  orgId: string,
  userId: string,
  accessToken: string,
  deltaState: Record<string, unknown>,
  log: pino.Logger,
  ownerEmail: string | null = null,
): Promise<void> {
  await assertSerumConnectorAllowed({
    orgId,
    connectorId: 'microsoft_graph',
    operation: 'calendar.pullIncremental',
    writeRequested: false,
  });

  let url =
    (deltaState['calendarNextLink'] as string | undefined) ??
    (deltaState['calendarDeltaLink'] as string | undefined) ??
    initialDeltaUrl();
  let count = 0;

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    const res = await providerFetch(url, { headers: GRAPH_READ_HEADERS(accessToken) }, { provider: 'Microsoft Graph' });

    if (res.status === 410) {
      log.warn({ tokenId }, 'Graph calendar delta expired (410); resyncing from scratch');
      const { calendarDeltaLink: _d, calendarNextLink: _n, ...rest } = deltaState;
      await prisma.integrationToken.update({ where: { id: tokenId }, data: { deltaState: rest as object } });
      return;
    }
    if (!res.ok) throw new Error(`MS Graph delta failed: ${res.status}`);

    const body = (await res.json()) as {
      value?: MsGraphEventItem[];
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    };
    const items = body.value ?? [];
    count += items.length;
    await upsertMicrosoftEvents(items, orgId, userId, ownerEmail, log);

    if (body['@odata.deltaLink']) {
      const { calendarNextLink: _n, ...rest } = deltaState;
      await prisma.integrationToken.update({
        where: { id: tokenId },
        data: { deltaState: { ...rest, calendarDeltaLink: body['@odata.deltaLink'] }, lastSyncedAt: new Date() },
      });
      log.debug({ tokenId, count }, 'MS Graph incremental pull complete');
      return;
    }
    if (!body['@odata.nextLink']) break;
    url = body['@odata.nextLink'];
  }

  await prisma.integrationToken.update({
    where: { id: tokenId },
    data: { deltaState: { ...deltaState, calendarNextLink: url }, lastSyncedAt: new Date() },
  });
  log.info({ tokenId, count }, 'MS Graph calendar pull paused at page cap; resuming next tick');
}

interface MsGraphEventItem extends GraphMeetingFields {
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
  ownerEmail: string | null,
  log: pino.Logger,
): Promise<void> {
  for (const item of items) {
    if (!item.id) continue;

    if (item['@removed']) {
      await prisma.calendarEvent.updateMany({
        where: { provider: 'microsoft_graph', externalId: item.id, orgId, ownerId: userId },
        data: { syncState: 'DELETED_REMOTE', isCancelled: true },
      });
      await syncRemovedEvents(orgId, userId, 'microsoft_graph', item.id, log);
      continue;
    }

    const isAllDay = item.isAllDay ?? false;
    const startAt = graphEventTime(item.start, isAllDay);
    const endAt = graphEventTime(item.end, isAllDay);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      log.warn({ eventId: item.id }, 'MS event without a readable start/end; skipping');
      continue;
    }

    try {
      const attendees = (item.attendees ?? []).map((a) => ({
        email: a.emailAddress.address,
        displayName: a.emailAddress.name,
        responseStatus: a.status?.response,
      }));
      const organizerEmail = item.organizer?.emailAddress?.address ?? null;
      const target = await resolveCaptureTarget({
        orgId,
        ownerEmail,
        participants: [...attendees.map((a) => a.email), ...(organizerEmail ? [organizerEmail] : [])],
      });

      const fields = {
        subject: item.subject ?? '(No title)',
        bodyPreview: item.bodyPreview?.slice(0, 500) ?? null,
        startAt,
        endAt,
        location: item.location?.displayName ?? null,
        isAllDay,
        isCancelled: item.isCancelled ?? false,
        attendees,
        organizerEmail,
        externalUpdatedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
        etag: item['@odata.etag'] ?? null,
        syncState: 'SYNCED' as const,
        lastSyncedAt: new Date(),
      };
      const filing = calendarFiling(target);

      const saved = await prisma.calendarEvent.upsert({
        where: {
          orgId_ownerId_provider_externalId: {
            orgId,
            ownerId: userId,
            provider: 'microsoft_graph',
            externalId: item.id,
          },
        },
        create: { orgId, ownerId: userId, externalId: item.id, provider: 'microsoft_graph', ...fields, ...filing },
        update: fields,
        select: { id: true },
      });
      await refileUnlessManual({ orgId, ownerId: userId, provider: 'microsoft_graph', externalId: item.id }, filing);
      await bridgeActivity(
        () => syncCalendarEventActivity(orgId, saved.id, { hints: graphMeetingHints(item) }),
        log,
        { eventId: item.id },
      );
    } catch (err) {
      log.warn({ err, eventId: item.id }, 'Failed to upsert MS event; skipping');
    }
  }
}

/** Cancel the activity of an event the provider removed. */
export async function syncRemovedEvents(
  orgId: string,
  ownerId: string,
  provider: 'microsoft_graph' | 'google_workspace',
  externalId: string,
  log: pino.Logger,
): Promise<void> {
  await bridgeActivity(
    async () => {
      const rows = await prisma.calendarEvent.findMany({
        where: { orgId, ownerId, provider, externalId },
        select: { id: true },
        take: 5,
      });
      for (const row of rows) await syncCalendarEventActivity(orgId, row.id);
    },
    log,
    { eventId: externalId },
  );
}
