import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import { checkSerumConnectorRuntimePolicy } from '@bidstack/db/serum-runtime-policy';

import { handleMicrosoftPush, pullMicrosoftIncremental } from './calendar-sync-microsoft.js';

vi.mock('@bidstack/db', () => ({
  prisma: {
    calendarEvent: {
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    integrationToken: {
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
const tokenUpdate = vi.mocked(prisma.integrationToken.update);

const orgId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const log = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
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
    subject: 'calendar.test:microsoft_graph',
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

describe('Microsoft Graph calendar connector SERUM gate', () => {
  it('blocks push before Graph network egress when SERUM connector policy denies', async () => {
    checkConnector.mockResolvedValueOnce({
      configType: 'connectors',
      configKey: 'registry',
      environment: 'dev',
      subject: 'calendar.push:microsoft_graph',
      allowed: false,
      status: 'not_configured',
      reason: 'No active SERUM Connectors policy is published.',
      activeConfigVersionId: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      handleMicrosoftPush({ event, operation: 'push', accessToken: 'token', log }),
    ).rejects.toThrow(/SERUM Connector policy denied Microsoft Graph/);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(calendarUpdate).not.toHaveBeenCalled();
  });

  it('allows push when SERUM permits the Microsoft Graph connector', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'ms-1', '@odata.etag': 'etag-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await handleMicrosoftPush({ event, operation: 'push', accessToken: 'token', log });

    expect(checkConnector).toHaveBeenCalledWith({
      orgId,
      environment: 'dev',
      configKey: 'registry',
      connectorId: 'microsoft_graph',
      operation: 'calendar.push',
      writeRequested: true,
      approvalConfirmed: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(calendarUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: event.id },
        data: expect.objectContaining({ externalId: 'ms-1', etag: 'etag-1' }),
      }),
    );
  });

  it('checks read-mode connector policy before Microsoft incremental pull', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: [], '@odata.deltaLink': 'next' }));
    vi.stubGlobal('fetch', fetchMock);

    await pullMicrosoftIncremental('token-1', orgId, userId, 'token', {}, log);

    expect(checkConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId,
        connectorId: 'microsoft_graph',
        operation: 'calendar.pullIncremental',
        writeRequested: false,
      }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'token-1' },
        data: expect.objectContaining({
          deltaState: expect.objectContaining({ calendarDeltaLink: 'next' }),
        }),
      }),
    );
  });
});
