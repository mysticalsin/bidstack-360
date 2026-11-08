// Google Calendar push, incremental pull, and watch channel renewal.

import { randomUUID } from 'node:crypto';

import type pino from 'pino';

import { prisma, syncCalendarEventActivity } from '@bidstack/db';
import { googleEventTime } from '@bidstack/shared';

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
  googleMeetingHints,
  meetingColumns,
  appendBridgeObservations,
  classifyStoredBridgeId,
  drainPendingActivityBridges,
  migrateLegacyBridgePending,
  noteActivityBridgeFailures,
  refileUnlessManual,
  resolveCaptureTarget,
  type GoogleMeetingFields,
} from '../lib/comms-capture.js';
import { syncRemovedEvents } from './calendar-sync-microsoft.js';
import { commitTokenDeltaState } from '../lib/activity-bridge-commit.js';
import { providerFetch } from '../lib/provider-http.js';
import { assertSerumConnectorAllowed } from '../lib/serum-connector-policy.js';

// ─── Google push ───────────────────────────────────────────────────────────

export async function handleGooglePush({
  event,
  operation,
  accessToken,
  connection,
  jobId,
  log,
}: PushParams): Promise<void> {
  await assertSerumConnectorAllowed({
    orgId: event.orgId,
    connectorId: 'google_workspace',
    operation: `calendar.${operation}`,
    writeRequested: true,
  });

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
    // Idempotency: the POST precedes the DB commit of externalId, so a BullMQ
    // retry after a crash between them would create a duplicate provider event.
    // Claim a per-job key BEFORE posting; a prior attempt that already created
    // will have set it, so we skip the re-create (see calendar-sync-claim.ts).
    if (!(await claimCalendarPush(connection, jobId, event.id, log))) return;
    let json: { id: string; etag: string };
    try {
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
      json = (await res.json()) as { id: string; etag: string };
    } catch (err) {
      // Google never accepted — release the claim so a legitimate retry can re-create.
      await releaseCalendarPushClaim(connection, jobId);
      throw err;
    }
    // Record the external id in the claim BEFORE the DB write so a crash here still blocks a re-create.
    await recordCalendarPushClaim(connection, jobId, { id: json.id, etag: json.etag });
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
    // The API soft-deleted the row before enqueueing; the explicit deletedAt
    // filter reaches past the soft-delete middleware.
    await prisma.calendarEvent.updateMany({
      where: { id: event.id, deletedAt: { not: null } },
      data: { syncState: 'SYNCED' },
    });
  }
}

// ─── Google incremental pull ───────────────────────────────────────────────

interface GoogleEventItem extends Omit<GoogleMeetingFields, 'attendees'> {
  id: string;
  iCalUID?: string;
  recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string };
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string; self?: boolean }>;
  organizer?: { email?: string };
  updated?: string;
  etag?: string;
}

/** Google gives every instance of a recurring series the same iCalUID. */
export function googleMeetingIdentity(
  item: Pick<GoogleEventItem, 'iCalUID' | 'recurringEventId' | 'originalStartTime'>,
): string | null {
  if (!item.iCalUID) return null;
  if (!item.recurringEventId) return item.iCalUID;
  const original = item.originalStartTime?.dateTime ?? item.originalStartTime?.date;
  if (!original) return null;
  const at = new Date(original);
  return `${item.iCalUID}#${Number.isNaN(at.getTime()) ? original : at.toISOString()}`;
}

const MAX_PAGES_PER_RUN = 20;
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

function googleListUrl(syncToken: string | undefined, pageToken: string | undefined, now = Date.now()): string {
  const params = new URLSearchParams({ maxResults: '250', singleEvents: 'true' });
  if (syncToken) params.set('syncToken', syncToken);
  else params.set('timeMin', new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString());
  if (pageToken) params.set('pageToken', pageToken);
  return `${EVENTS_URL}?${params.toString()}`;
}

/**
 * Pull changed events with Google sync tokens, following nextPageToken until
 * Google returns nextSyncToken (only the last page carries it). A run that
 * hits the page cap stores the page token and resumes next tick.
 */
export async function pullGoogleIncremental(
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
    connectorId: 'google_workspace',
    operation: 'calendar.pullIncremental',
    writeRequested: false,
  });

  const baseline = structuredClone(deltaState);
  const syncToken = deltaState['calendarSyncToken'] as string | undefined;
  let pageToken = deltaState['calendarPageToken'] as string | undefined;
  let count = 0;
  const bridgeDeltas: Parameters<typeof appendBridgeObservations>[0] = [];
  const legacyPlan = await migrateLegacyBridgePending(deltaState, (id) => classifyStoredBridgeId(prisma, { orgId, ownerId: userId }, id));

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    const res = await providerFetch(
      googleListUrl(syncToken, pageToken),
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { provider: 'Google Calendar' },
    );

    if (res.status === 410) {
      log.warn({ tokenId }, 'Google sync token expired; clearing for full re-sync');
      const { calendarSyncToken: _s, calendarPageToken: _p, ...rest } = deltaState;
      await commitTokenDeltaState(prisma, tokenId, baseline, rest, bridgeDeltas, legacyPlan);
      return;
    }
    if (!res.ok) throw new Error(`Google events list failed: ${res.status}`);

    const body = (await res.json()) as { items?: GoogleEventItem[]; nextSyncToken?: string; nextPageToken?: string };
    const items = body.items ?? [];
    count += items.length;
    const { failed, settled, captureHeld } = await upsertGoogleEvents(items, orgId, userId, ownerEmail, log);
    const pageKey = `google:${syncToken ?? ''}:${pageToken ?? ''}`;
    const bridge = noteActivityBridgeFailures(deltaState, pageKey, failed, new Date().toISOString(), settled, true, undefined, 'calendar');
    const drained = typeof prisma.calendarEvent?.findFirst === 'function'
      ? await drainPendingActivityBridges(deltaState, async (providerId) => {
      const row = await prisma.calendarEvent.findFirst({
        where: { orgId, ownerId: userId, provider: 'google_workspace', externalId: providerId, deletedAt: null },
        select: { id: true },
      });
      if (!row) return 'gone';
      const ok = await bridgeActivity(() => syncCalendarEventActivity(orgId, row.id), log, { eventId: providerId });
      return ok;
    }, new Date().toISOString(), 'calendar')
      : null;
    appendBridgeObservations(bridgeDeltas, pageKey, failed, settled, drained, 'calendar');
    if (bridge.quarantined.length > 0) {
      log.warn({ tokenId, ids: bridge.quarantined }, 'Account activity bridge quarantined after repeated failures');
    }
    if (captureHeld.length > 0 || bridge.backpressure || (drained?.hold ?? bridge.hold)) {
      await commitTokenDeltaState(
        prisma,
        tokenId,
        baseline,
        { ...deltaState, ...(pageToken ? { calendarPageToken: pageToken } : {}) },
        bridgeDeltas,
        legacyPlan,
      );
      log.warn({ tokenId }, 'Account activity bridge failed; calendar page will be retried before the cursor advances');
      return;
    }

    if (body.nextSyncToken) {
      const { calendarPageToken: _p, ...rest } = deltaState;
      await commitTokenDeltaState(prisma, tokenId, baseline, { ...rest, calendarSyncToken: body.nextSyncToken }, bridgeDeltas, legacyPlan);
      log.debug({ tokenId, count }, 'Google incremental pull complete');
      return;
    }
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }

  await commitTokenDeltaState(
    prisma,
    tokenId,
    baseline,
    { ...deltaState, ...(pageToken ? { calendarPageToken: pageToken } : {}) },
    bridgeDeltas,
    legacyPlan,
  );
  log.info({ tokenId, count }, 'Google calendar pull paused at page cap; resuming next tick');
}

async function upsertGoogleEvents(
  items: GoogleEventItem[],
  orgId: string,
  userId: string,
  ownerEmail: string | null,
  log: pino.Logger,
): Promise<{ failed: string[]; settled: string[]; captureHeld: string[] }> {
  const failed: string[] = [];
  const settled: string[] = [];
  const captureHeld: string[] = [];
  for (const item of items) {
    if (!item.id) continue;

    if (item.status === 'cancelled') {
      await prisma.calendarEvent.updateMany({
        where: { provider: 'google_workspace', externalId: item.id, orgId, ownerId: userId },
        data: { syncState: 'DELETED_REMOTE', isCancelled: true },
      });
      const removed = await syncRemovedEvents(orgId, userId, 'google_workspace', item.id, log);
      if (!removed) failed.push(item.id);
      else settled.push(item.id);
      continue;
    }

    const startAt = googleEventTime(item.start);
    const endAt = googleEventTime(item.end);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      log.warn({ eventId: item.id }, 'Google event without a readable start/end; skipping');
      settled.push(item.id);
      continue;
    }
    const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);

    let captured = false;
    try {
      const attendees = item.attendees ?? [];
      const organizerEmail = item.organizer?.email ?? null;
      const hints = googleMeetingHints(item);
      const target = await resolveCaptureTarget({
        orgId,
        ownerEmail,
        participants: [...attendees.map((a) => a.email), ...(organizerEmail ? [organizerEmail] : [])],
      });
      const fields = {
        subject: item.summary ?? '(No title)',
        bodyPreview: item.description?.slice(0, 500) ?? null,
        startAt,
        endAt,
        location: item.location ?? null,
        isAllDay,
        isCancelled: false,
        attendees,
        organizerEmail,
        externalUpdatedAt: item.updated ? new Date(item.updated) : null,
        etag: item.etag ?? null,
        syncState: 'SYNCED' as const,
        lastSyncedAt: new Date(),
        ...meetingColumns(hints, googleMeetingIdentity(item)),
      };
      const filing = calendarFiling(target);
      const saved = await prisma.calendarEvent.upsert({
        where: {
          orgId_ownerId_provider_externalId: {
            orgId,
            ownerId: userId,
            provider: 'google_workspace',
            externalId: item.id,
          },
        },
        create: { orgId, ownerId: userId, externalId: item.id, provider: 'google_workspace', ...fields, ...filing },
        update: fields,
        select: { id: true },
      });
      await refileUnlessManual({ orgId, ownerId: userId, provider: 'google_workspace', externalId: item.id }, filing);
      captured = true;
      const ok = await bridgeActivity(
        () => syncCalendarEventActivity(orgId, saved.id, { hints }),
        log,
        { eventId: item.id },
      );
      if (!ok) failed.push(item.id);
      else settled.push(item.id);
    } catch (err) {
      if (captured) failed.push(item.id);
      else captureHeld.push(item.id);
      log.warn({ err, eventId: item.id }, 'Failed to upsert Google event; skipping');
    }
  }
  return { failed, settled, captureHeld };
}

// ─── Google watch channel renewal ─────────────────────────────────────────

export async function renewGoogleWatchChannel(
  orgId: string,
  tokenId: string,
  accessToken: string,
  log: pino.Logger,
  deltaState: Record<string, unknown> = {},
): Promise<void> {
  await assertSerumConnectorAllowed({
    orgId,
    connectorId: 'google_workspace',
    operation: 'calendar.watchRenew',
    writeRequested: true,
  });

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

  const baseline = structuredClone(deltaState);
  await commitTokenDeltaState(
    prisma,
    tokenId,
    baseline,
    {
      ...deltaState,
      watchChannelId: json.id,
      watchChannelExpiry: new Date(Number(json.expiration)).toISOString(),
    },
    [],
  );

  log.info({ tokenId, channelId: json.id }, 'Google watch channel renewed');
}
