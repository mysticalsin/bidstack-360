// Calendar incremental pull against mocked Graph / Google responses:
// paging, delta cursors, timezone handling, per-owner dedupe and filing.
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeStore = vi.hoisted(() => {
  const persisted = { delta: {} as Record<string, unknown> };
  const tokenUpdate = vi.fn(async (args: { data?: { deltaState?: Record<string, unknown> } }) => {
    if (args?.data?.deltaState) persisted.delta = structuredClone(args.data.deltaState);
  });
  const prismaMock = {
    calendarEvent: {
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(async () => ({ id: 'row-1' })),
      findMany: vi.fn(async () => []),
    },
    integrationToken: {
      update: tokenUpdate,
      findFirst: vi.fn(async () => ({ deltaState: persisted.delta })),
    },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ delta_state: structuredClone(persisted.delta) }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(prismaMock)),
  };
  return { persisted, tokenUpdate, prismaMock };
});

import { ACTIVITY_BRIDGE_RETRY_LIMIT } from '../lib/comms-capture.js';
import type * as CommsCapture from '../lib/comms-capture.js';

import { prisma, syncCalendarEventActivity } from '@bidstack/db';
import { checkSerumConnectorRuntimePolicy } from '@bidstack/db/serum-runtime-policy';

import { pullMicrosoftIncremental } from './calendar-sync-microsoft.js';
import { pullGoogleIncremental } from './calendar-sync-google.js';
import { ProviderRateLimitError } from '../lib/provider-http.js';

vi.mock('@bidstack/db', () => ({
  prisma: bridgeStore.prismaMock,
  syncCalendarEventActivity: vi.fn(async () => ({ action: 'created', activityId: 'act-1' })),
  syncEmailMessageActivity: vi.fn(async () => ({ action: 'created', activityId: 'act-1' })),
  EmailProvider: { GMAIL: 'GMAIL', OUTLOOK: 'OUTLOOK' },
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { connectors: 'registry' },
  checkSerumConnectorRuntimePolicy: vi.fn(),
}));

vi.mock('../lib/comms-capture.js', async (importOriginal) => ({
  ...(await importOriginal<typeof CommsCapture>()),
  resolveCaptureTarget: vi.fn(async () => ({
    entityType: 'contact',
    entityId: 'contact-1',
    contactId: 'contact-1',
    companyId: 'company-1',
    opportunityId: 'opp-1',
  })),
}));

const orgId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as pino.Logger;
const upsert = vi.mocked(prisma.calendarEvent.upsert);
const updateMany = vi.mocked(prisma.calendarEvent.updateMany);
const tokenUpdate = vi.mocked(prisma.integrationToken.update);

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// The update branch of the upsert must leave filing alone; auto filing of an
// existing row only lands where nobody filed it by hand.
function expectFilingPreserved(provider: string, externalId: string): void {
  const call = upsert.mock.calls[0]?.[0] as unknown as {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
  expect(call.create).toMatchObject({ contactId: 'contact-1', companyId: 'company-1', opportunityId: 'opp-1' });
  for (const key of ['contactId', 'companyId', 'opportunityId', 'relatedEntityType', 'relatedEntityId']) {
    expect(call.update).not.toHaveProperty(key);
  }
  expect(updateMany).toHaveBeenCalledWith({
    where: { orgId, ownerId: userId, provider, externalId, filedManually: false },
    data: {
      relatedEntityType: 'contact',
      relatedEntityId: 'contact-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      opportunityId: 'opp-1',
    },
  });
}

beforeEach(() => {
  upsert.mockReset();
  upsert.mockResolvedValue({ id: 'row-1' } as never);
  vi.mocked(syncCalendarEventActivity).mockReset();
  vi.mocked(syncCalendarEventActivity).mockResolvedValue({ action: 'created', activityId: 'act-1' });
  vi.mocked(checkSerumConnectorRuntimePolicy).mockResolvedValue({
    configType: 'connectors',
    configKey: 'registry',
    environment: 'dev',
    subject: 'calendar',
    allowed: true,
    status: 'allowed',
    reason: 'allowed',
    activeConfigVersionId: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  bridgeStore.persisted.delta = {};
  vi.mocked(syncCalendarEventActivity).mockResolvedValue({ action: 'created', activityId: 'act-1' });
});

describe('Microsoft calendar pull', () => {
  it('follows nextLink pages, asks for UTC and keeps the other cursors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          value: [
            {
              id: 'ev-1',
              subject: 'Steering committee',
              start: { dateTime: '2026-11-09T14:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-11-09T15:00:00.0000000', timeZone: 'UTC' },
              attendees: [{ emailAddress: { address: 'buyer@acme.com' } }],
            },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=p2',
        }),
      )
      .mockResolvedValueOnce(
        json({
          value: [
            {
              id: 'ev-2',
              subject: 'Bid day',
              isAllDay: true,
              start: { dateTime: '2026-11-10T00:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-11-12T00:00:00.0000000', timeZone: 'UTC' },
            },
          ],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=d1',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    bridgeStore.persisted.delta = { mailDeltaLink: 'keep-me' };
    await pullMicrosoftIncremental('tok-1', orgId, userId, 'at', { mailDeltaLink: 'keep-me' }, log, 'tony@amaris.com');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>;
      expect(headers.Prefer).toContain('outlook.timezone="UTC"');
    }
    expect(upsert).toHaveBeenCalledTimes(2);
    const first = upsert.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(first.where).toEqual({
      orgId_ownerId_provider_externalId: { orgId, ownerId: userId, provider: 'microsoft_graph', externalId: 'ev-1' },
    });
    expect((first.create.startAt as Date).toISOString()).toBe('2026-11-09T14:00:00.000Z');
    expect(first.create).toMatchObject({
      relatedEntityType: 'contact',
      relatedEntityId: 'contact-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      opportunityId: 'opp-1',
    });
    const second = upsert.mock.calls[1]?.[0] as unknown as { create: Record<string, unknown> };
    expect((second.create.startAt as Date).toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(second.create.isAllDay).toBe(true);

    expect(tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deltaState: {
            mailDeltaLink: 'keep-me',
            calendarDeltaLink: 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=d1',
          },
        }),
      }),
    );
  });

  it('scopes remote deletions to the owner of this calendar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ value: [{ id: 'gone', '@removed': { reason: 'deleted' } }], '@odata.deltaLink': 'd' })),
    );
    await pullMicrosoftIncremental('tok-1', orgId, userId, 'at', {}, log);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: 'microsoft_graph', externalId: 'gone', orgId, ownerId: userId },
      }),
    );
  });

  it('never overwrites filing a user set by hand on an existing event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({
          value: [
            {
              id: 'ev-1',
              subject: 'Steering committee',
              start: { dateTime: '2026-11-09T14:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-11-09T15:00:00.0000000', timeZone: 'UTC' },
              attendees: [{ emailAddress: { address: 'buyer@acme.com' } }],
            },
          ],
          '@odata.deltaLink': 'd',
        }),
      ),
    );
    await pullMicrosoftIncremental('tok-1', orgId, userId, 'at', {}, log, 'tony@amaris.com');
    expectFilingPreserved('microsoft_graph', 'ev-1');
  });

  it('hands each saved event to the activity bridge with Teams, private and declined hints', async () => {
    upsert.mockResolvedValue({ id: 'row-1' } as never);
    vi.mocked(syncCalendarEventActivity).mockRejectedValueOnce(new Error('db down'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({
          value: [
            {
              id: 'ev-teams',
              iCalUId: '040000008200E00074C5B7101A82E008',
              subject: 'Weekly sync',
              start: { dateTime: '2026-11-09T14:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-11-09T15:00:00.0000000', timeZone: 'UTC' },
              isOnlineMeeting: true,
              onlineMeetingProvider: 'teamsForBusiness',
              onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' },
            },
            {
              id: 'ev-private',
              subject: 'Doctor',
              start: { dateTime: '2026-11-09T16:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-11-09T17:00:00.0000000', timeZone: 'UTC' },
              sensitivity: 'private',
              responseStatus: { response: 'declined' },
            },
          ],
          '@odata.deltaLink': 'd',
        }),
      ),
    );
    await pullMicrosoftIncremental('tok-1', orgId, userId, 'at', {}, log, 'tony@amaris.com');

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(syncCalendarEventActivity).toHaveBeenNthCalledWith(1, orgId, 'row-1', {
      hints: { channel: 'teams', isPrivate: false, ownerDeclined: false },
    });
    expect(syncCalendarEventActivity).toHaveBeenNthCalledWith(2, orgId, 'row-1', {
      hints: { channel: 'in_person_or_other', isPrivate: true, ownerDeclined: true },
    });
    // Stored so a colleague's copy of the same meeting merges into one activity.
    const [teams, priv] = upsert.mock.calls.map((c) => (c[0] as unknown as { update: Record<string, unknown> }).update);
    expect(teams).toMatchObject({
      iCalUid: '040000008200E00074C5B7101A82E008',
      isPrivate: false,
      ownerResponse: null,
      meetingChannel: 'teams',
    });
    expect(priv).toMatchObject({ iCalUid: null, isPrivate: true, ownerResponse: 'declined' });
    // The first bridge failed. The saved events stay, but the delta link must
    // not advance or Graph will never offer those unchanged items again.
    const saved = tokenUpdate.mock.calls.at(-1)?.[0] as {
      data: { deltaState: Record<string, unknown> };
    };
    expect(saved.data.deltaState.calendarDeltaLink).toBeUndefined();
    expect(saved.data.deltaState.calendarNextLink).toEqual(expect.stringContaining('/calendarView/delta'));
  });

  it('quarantines a poison event after the retry bound so the cursor can move', async () => {
    upsert.mockResolvedValue({ id: 'row-1' } as never);
    vi.mocked(syncCalendarEventActivity).mockRejectedValue(new Error('db down'));
    const poison = {
      value: [
        {
          id: 'ev-poison',
          subject: 'Stuck',
          start: { dateTime: '2026-11-09T14:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-11-09T15:00:00.0000000', timeZone: 'UTC' },
        },
      ],
      '@odata.deltaLink': 'd-next',
    };
    vi.stubGlobal('fetch', vi.fn(async () => json(poison)));
    let state: Record<string, unknown> = {};
    for (let attempt = 0; attempt < ACTIVITY_BRIDGE_RETRY_LIMIT - 1; attempt++) {
      await pullMicrosoftIncremental('tok-1', orgId, userId, 'at', state, log, 'tony@amaris.com');
      state = (
        tokenUpdate.mock.calls.at(-1)?.[0] as { data: { deltaState: Record<string, unknown> } }
      ).data.deltaState;
      expect(state.calendarDeltaLink).toBeUndefined();
      expect(state.calendarNextLink).toEqual(expect.stringContaining('/calendarView/delta'));
    }
    await pullMicrosoftIncremental('tok-1', orgId, userId, 'at', state, log, 'tony@amaris.com');
    const last = (
      tokenUpdate.mock.calls.at(-1)?.[0] as { data: { deltaState: Record<string, unknown> } }
    ).data.deltaState;
    expect(last.calendarDeltaLink).toBe('d-next');
    expect(last.calendarNextLink).toBeUndefined();
    expect(last.activityBridgeQuarantine).toEqual([
      expect.objectContaining({ id: 'ev-poison', attempts: ACTIVITY_BRIDGE_RETRY_LIMIT }),
    ]);
    expect(JSON.stringify(last.activityBridgeQuarantine)).not.toContain('Stuck');
  });

  it('holds the page when saving an event throws', async () => {
    upsert.mockRejectedValueOnce(new Error('write failed'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          value: [
            {
              id: 'ev-throw',
              subject: 'Secret subject',
              start: { dateTime: '2026-11-09T14:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-11-09T15:00:00.0000000', timeZone: 'UTC' },
            },
          ],
          '@odata.deltaLink': 'd-next',
        }),
      ),
    );
    await pullMicrosoftIncremental('tok-1', orgId, userId, 'at', {}, log, 'tony@amaris.com');
    const saved = tokenUpdate.mock.calls.at(-1)?.[0] as { data: { deltaState: Record<string, unknown> } };
    expect(saved.data.deltaState.calendarDeltaLink).toBeUndefined();
    expect(saved.data.deltaState.calendarNextLink).toEqual(expect.stringContaining('/calendarView/delta'));
    const counts = saved.data.deltaState.activityBridgeRetryById as Record<string, number>;
    expect(counts['ev-throw']).toBe(1);
    expect(JSON.stringify(saved.data.deltaState)).not.toContain('Secret subject');
  });

  it('raises a rate limit error with the Retry-After wait on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 429, { 'Retry-After': '9' })));
    const err = await pullMicrosoftIncremental('tok-1', orgId, userId, 'at', {}, log).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect((err as ProviderRateLimitError).retryAfterMs).toBe(9_000);
    expect(tokenUpdate).not.toHaveBeenCalled();
  });
});

describe('Google calendar pull', () => {
  it('pages with nextPageToken, stores the sync token and pins all-day dates', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          items: [
            {
              id: 'g-1',
              summary: 'Client workshop',
              start: { dateTime: '2026-11-09T10:00:00-05:00' },
              end: { dateTime: '2026-11-09T11:30:00-05:00' },
              attendees: [{ email: 'buyer@acme.com' }],
            },
          ],
          nextPageToken: 'page-2',
        }),
      )
      .mockResolvedValueOnce(
        json({
          items: [{ id: 'g-2', summary: 'Holiday', start: { date: '2026-11-11' }, end: { date: '2026-11-12' } }],
          nextSyncToken: 'sync-1',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    bridgeStore.persisted.delta = { watchChannelId: 'ch-1' };
    await pullGoogleIncremental('tok-2', orgId, userId, 'at', { watchChannelId: 'ch-1' }, log, 'tony@amaris.com');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('pageToken=page-2');
    const [first, second] = upsert.mock.calls.map((c) => c[0] as unknown as { where: Record<string, unknown>; create: Record<string, unknown> });
    expect(first?.where).toEqual({
      orgId_ownerId_provider_externalId: { orgId, ownerId: userId, provider: 'google_workspace', externalId: 'g-1' },
    });
    expect((first?.create.startAt as Date).toISOString()).toBe('2026-11-09T15:00:00.000Z');
    expect(first?.create.opportunityId).toBe('opp-1');
    expect((second?.create.startAt as Date).toISOString()).toBe('2026-11-11T00:00:00.000Z');
    expect(second?.create.isAllDay).toBe(true);
    expect(tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deltaState: { watchChannelId: 'ch-1', calendarSyncToken: 'sync-1' } }),
      }),
    );
  });

  it('never overwrites filing a user set by hand on an existing event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({
          items: [
            {
              id: 'g-1',
              summary: 'Client workshop',
              start: { dateTime: '2026-11-09T10:00:00-05:00' },
              end: { dateTime: '2026-11-09T11:30:00-05:00' },
              attendees: [{ email: 'buyer@acme.com' }],
            },
          ],
          nextSyncToken: 'sync-1',
        }),
      ),
    );
    await pullGoogleIncremental('tok-2', orgId, userId, 'at', {}, log, 'tony@amaris.com');
    expectFilingPreserved('google_workspace', 'g-1');
  });

  it('stores a calendar identity per instance of a recurring meeting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({
          items: [
            {
              id: 'g-1',
              iCalUID: 'weekly@google.com',
              recurringEventId: 'g-series',
              originalStartTime: { dateTime: '2026-11-09T10:00:00-05:00' },
              summary: 'Weekly client sync',
              start: { dateTime: '2026-11-09T11:00:00-05:00' },
              end: { dateTime: '2026-11-09T12:00:00-05:00' },
              attendees: [{ email: 'buyer@acme.com' }],
            },
            {
              id: 'g-2',
              iCalUID: 'once@google.com',
              summary: 'Kickoff',
              start: { dateTime: '2026-11-10T10:00:00-05:00' },
              end: { dateTime: '2026-11-10T11:00:00-05:00' },
              attendees: [{ email: 'buyer@acme.com' }],
            },
          ],
          nextSyncToken: 'sync-1',
        }),
      ),
    );
    await pullGoogleIncremental('tok-2', orgId, userId, 'at', {}, log, 'tony@amaris.com');
    const ids = upsert.mock.calls.map((c) => (c[0] as unknown as { update: { iCalUid: unknown } }).update.iCalUid);
    // Moving one instance keeps its original slot, so every attendee's copy still matches.
    expect(ids).toEqual(['weekly@google.com#2026-11-09T15:00:00.000Z', 'once@google.com']);
  });

  it('holds the page when saving an event throws', async () => {
    upsert.mockRejectedValueOnce(new Error('write failed'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          items: [
            {
              id: 'g-throw',
              summary: 'Secret subject',
              start: { dateTime: '2026-11-09T10:00:00Z' },
              end: { dateTime: '2026-11-09T11:00:00Z' },
            },
          ],
          nextSyncToken: 'sync-next',
        }),
      ),
    );
    bridgeStore.persisted.delta = { watchChannelId: 'ch-1' };
    await pullGoogleIncremental('tok-2', orgId, userId, 'at', { watchChannelId: 'ch-1' }, log, 'tony@amaris.com');
    const saved = tokenUpdate.mock.calls.at(-1)?.[0] as { data: { deltaState: Record<string, unknown> } };
    expect(saved.data.deltaState.calendarSyncToken).toBeUndefined();
    expect(saved.data.deltaState.watchChannelId).toBe('ch-1');
    const counts = saved.data.deltaState.activityBridgeRetryById as Record<string, number>;
    expect(counts['g-throw']).toBe(1);
    expect(JSON.stringify(saved.data.deltaState)).not.toContain('Secret subject');
  });

  it('drops only the calendar cursor when the sync token expires', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 410)));
    bridgeStore.persisted.delta = { calendarSyncToken: 'old', gmailHistoryId: '77' };
    await pullGoogleIncremental('tok-2', orgId, userId, 'at', { calendarSyncToken: 'old', gmailHistoryId: '77' }, log);
    expect(tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deltaState: { gmailHistoryId: '77' } }) }),
    );
  });
});
