// A calendar pull whose event list has not arrived must not look like a
// finished empty sync. An empty array is a settled quiet book. A missing
// list is not that book, and the cursor must stay where it was.
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import { checkSerumConnectorRuntimePolicy } from '@bidstack/db/serum-runtime-policy';

import { pullGoogleIncremental } from './calendar-sync-google.js';
import { pullMicrosoftIncremental } from './calendar-sync-microsoft.js';

vi.mock('@bidstack/db', () => ({
  prisma: {
    unlockedCursorTestAdapter: true,
    calendarEvent: {
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    integrationToken: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
  },
  syncCalendarEventActivity: vi.fn(async () => ({ action: 'created', activityId: 'act-1' })),
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { connectors: 'registry' },
  checkSerumConnectorRuntimePolicy: vi.fn(),
}));

const checkConnector = vi.mocked(checkSerumConnectorRuntimePolicy);
const tokenUpdate = vi.mocked(prisma.integrationToken.update);

const orgId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as pino.Logger;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  checkConnector.mockResolvedValue({
    configType: 'connectors',
    configKey: 'registry',
    environment: 'dev',
    subject: 'calendar.test',
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

describe('calendar pull waits for the event list', () => {
  it('does not finish a Google pull when the event list is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ nextSyncToken: 'sync-unread' })),
    );

    await expect(
      pullGoogleIncremental('token-g', orgId, userId, 'token', {}, log),
    ).rejects.toThrow(/has not arrived/);

    expect(tokenUpdate).not.toHaveBeenCalled();
  });

  it('does not finish a Microsoft pull when the event list is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ '@odata.deltaLink': 'delta-unread' })),
    );

    await expect(
      pullMicrosoftIncremental('token-m', orgId, userId, 'token', {}, log),
    ).rejects.toThrow(/has not arrived/);

    expect(tokenUpdate).not.toHaveBeenCalled();
  });

  it('still finishes a Google pull when the event list arrived empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ items: [], nextSyncToken: 'sync-empty' })),
    );

    await pullGoogleIncremental('token-g', orgId, userId, 'token', {}, log);

    expect(tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deltaState: expect.objectContaining({ calendarSyncToken: 'sync-empty' }),
        }),
      }),
    );
  });

  it('still finishes a Microsoft pull when the event list arrived empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ value: [], '@odata.deltaLink': 'delta-empty' })),
    );

    await pullMicrosoftIncremental('token-m', orgId, userId, 'token', {}, log);

    expect(tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deltaState: expect.objectContaining({ calendarDeltaLink: 'delta-empty' }),
        }),
      }),
    );
  });
});
