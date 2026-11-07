// Calendar incremental pull against mocked Graph / Google responses:
// paging, delta cursors, timezone handling, per-owner dedupe and filing.
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import { checkSerumConnectorRuntimePolicy } from '@bidstack/db/serum-runtime-policy';

import { pullMicrosoftIncremental } from './calendar-sync-microsoft.js';
import { pullGoogleIncremental } from './calendar-sync-google.js';
import { ProviderRateLimitError } from '../lib/provider-http.js';

vi.mock('@bidstack/db', () => ({
  prisma: {
    calendarEvent: { update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    integrationToken: { update: vi.fn() },
  },
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { connectors: 'registry' },
  checkSerumConnectorRuntimePolicy: vi.fn(),
}));

vi.mock('../lib/comms-capture.js', () => ({
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

beforeEach(() => {
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

  it('drops only the calendar cursor when the sync token expires', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 410)));
    await pullGoogleIncremental('tok-2', orgId, userId, 'at', { calendarSyncToken: 'old', gmailHistoryId: '77' }, log);
    expect(tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deltaState: { gmailHistoryId: '77' } }) }),
    );
  });
});
