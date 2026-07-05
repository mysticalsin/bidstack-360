import type IORedis from 'ioredis';
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import { checkSerumConnectorRuntimePolicy } from '@bidstack/db/serum-runtime-policy';

import { handleGooglePush } from './calendar-sync-google.js';
import { handleMicrosoftPush } from './calendar-sync-microsoft.js';

// WHY mock the DB: the regression under test is the crash window between the
// provider POST and the calendarEvent.update that records externalId. We make
// that update fail on demand to simulate the crash, then assert the retry does
// NOT re-POST — without the claim guard it would create a second, permanently
// orphaned event in the user's real Google/MS calendar.
vi.mock('@bidstack/db', () => ({
  prisma: {
    calendarEvent: {
      update: vi.fn(),
    },
  },
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: {
    connectors: 'registry',
  },
  checkSerumConnectorRuntimePolicy: vi.fn(),
}));

const checkConnector = vi.mocked(checkSerumConnectorRuntimePolicy);
const calendarUpdate = vi.mocked(prisma.calendarEvent.update);

const orgId = '00000000-0000-4000-8000-000000000001';
const log = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as pino.Logger;

const event = {
  id: '00000000-0000-4000-8000-000000000003',
  orgId,
  externalId: null,
  subject: 'Bid review',
  bodyPreview: 'Review next steps',
  startAt: new Date('2026-06-17T14:00:00.000Z'),
  endAt: new Date('2026-06-17T14:30:00.000Z'),
  location: null,
  attendees: [],
  etag: null,
};

/**
 * Minimal in-memory IORedis stub honoring exactly the three ops the claim uses.
 * `set` respects NX (returns 'OK' only when the key is absent) so the retry of
 * the SAME jobId sees the prior attempt's claim — the same signal a real Redis
 * gives BullMQ on a retry after a crash between POST and DB commit.
 */
function makeFakeRedis(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const set = vi.fn(
    (key: string, val: string, _ex?: string, _ttl?: number, nx?: string): string | null => {
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    },
  );
  const get = vi.fn((key: string): string | null => store.get(key) ?? null);
  const del = vi.fn((key: string): number => (store.delete(key) ? 1 : 0));
  return { connection: { set, get, del } as unknown as IORedis, store, set, get, del };
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  checkConnector.mockResolvedValue({
    configType: 'connectors',
    configKey: 'registry',
    environment: 'dev',
    subject: 'calendar.push:test',
    allowed: true,
    status: 'allowed',
    reason: 'Connector operation is allowed by the active SERUM policy.',
    activeConfigVersionId: '00000000-0000-4000-8000-000000000099',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('calendar push idempotency (POST-before-DB-commit crash window)', () => {
  it('MS: retry after create succeeded but DB write failed does NOT create a second Graph event', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ id: 'ms-1', '@odata.etag': 'etag-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const redis = makeFakeRedis();

    // Attempt 1: Graph create succeeds, then the externalId commit blips → BullMQ retries.
    calendarUpdate.mockRejectedValueOnce(new Error('db blip'));
    await expect(
      handleMicrosoftPush({
        event,
        operation: 'push',
        accessToken: 'token',
        connection: redis.connection,
        jobId: 'job-1',
        log,
      }),
    ).rejects.toThrow('db blip');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Attempt 2 (same jobId, event re-fetched with externalId still null):
    // the duplicate POST is the bug — the provider event already exists.
    calendarUpdate.mockResolvedValueOnce({} as never);
    await handleMicrosoftPush({
      event,
      operation: 'push',
      accessToken: 'token',
      connection: redis.connection,
      jobId: 'job-1',
      log,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Instead it reconciles the lost DB row from the claim's recorded external id.
    expect(calendarUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: event.id },
        data: expect.objectContaining({ externalId: 'ms-1', etag: 'etag-1', syncState: 'SYNCED' }),
      }),
    );
  });

  it('Google: retry after create succeeded but DB write failed does NOT create a second event', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: 'g-1', etag: 'g-etag' }));
    vi.stubGlobal('fetch', fetchMock);
    const redis = makeFakeRedis();

    calendarUpdate.mockRejectedValueOnce(new Error('db blip'));
    await expect(
      handleGooglePush({
        event,
        operation: 'push',
        accessToken: 'token',
        connection: redis.connection,
        jobId: 'job-2',
        log,
      }),
    ).rejects.toThrow('db blip');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    calendarUpdate.mockResolvedValueOnce({} as never);
    await handleGooglePush({
      event,
      operation: 'push',
      accessToken: 'token',
      connection: redis.connection,
      jobId: 'job-2',
      log,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calendarUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: event.id },
        data: expect.objectContaining({ externalId: 'g-1', etag: 'g-etag', syncState: 'SYNCED' }),
      }),
    );
  });

  it('a rejected create releases the claim so a legitimate retry can re-POST', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const redis = makeFakeRedis();

    await expect(
      handleGooglePush({
        event,
        operation: 'push',
        accessToken: 'token',
        connection: redis.connection,
        jobId: 'job-3',
        log,
      }),
    ).rejects.toThrow('network down');

    // Provider never accepted → claim freed, otherwise transient failures would
    // strand the event unpushed for the whole claim TTL.
    expect(redis.del).toHaveBeenCalledWith('calendar:push:claim:job-3');
    expect(redis.store.has('calendar:push:claim:job-3')).toBe(false);

    fetchMock.mockResolvedValue(okResponse({ id: 'g-1', etag: 'g-etag' }));
    calendarUpdate.mockResolvedValueOnce({} as never);
    await handleGooglePush({
      event,
      operation: 'push',
      accessToken: 'token',
      connection: redis.connection,
      jobId: 'job-3',
      log,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a claim stuck at "pending" (crash mid-POST, outcome unknown) skips rather than risk a duplicate', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const redis = makeFakeRedis({ 'calendar:push:claim:job-4': 'pending' });

    await handleMicrosoftPush({
      event,
      operation: 'push',
      accessToken: 'token',
      connection: redis.connection,
      jobId: 'job-4',
      log,
    });

    // Ambiguous prior outcome: prefer no-duplicate over guaranteed delivery,
    // matching the sms.send claim semantics.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calendarUpdate).not.toHaveBeenCalled();
  });
});
