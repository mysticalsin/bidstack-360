import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkSerumConnectorRuntimePolicy } from '@bidstack/db/serum-runtime-policy';

const mocks = vi.hoisted(() => ({
  auditLogCreate: vi.fn(),
  calendarEventUpdate: vi.fn(),
  calendarEventUpdateMany: vi.fn(),
  calendarEventUpsert: vi.fn(),
  executeRaw: vi.fn(),
  integrationTokenUpdate: vi.fn(),
  migrationJobFindUnique: vi.fn(),
  migrationJobUpdate: vi.fn(),
  webhookDeliveryCreate: vi.fn(),
  webhookSubscriptionFindFirst: vi.fn(),
  webhookSubscriptionFindMany: vi.fn(),
  webhookSubscriptionUpdate: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
  },
  prisma: {
    $executeRaw: mocks.executeRaw,
    auditLog: {
      create: mocks.auditLogCreate,
    },
    calendarEvent: {
      update: mocks.calendarEventUpdate,
      updateMany: mocks.calendarEventUpdateMany,
      upsert: mocks.calendarEventUpsert,
    },
    integrationToken: {
      update: mocks.integrationTokenUpdate,
    },
    migrationJob: {
      findUnique: mocks.migrationJobFindUnique,
      update: mocks.migrationJobUpdate,
    },
    webhookDelivery: {
      create: mocks.webhookDeliveryCreate,
    },
    webhookSubscription: {
      findFirst: mocks.webhookSubscriptionFindFirst,
      findMany: mocks.webhookSubscriptionFindMany,
      update: mocks.webhookSubscriptionUpdate,
    },
  },
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: {
    connectors: 'registry',
  },
  checkSerumConnectorRuntimePolicy: vi.fn(),
}));

import { handleGooglePush } from './calendar-sync-google.js';
import { fetchHubSpotPage } from './migration.js';
import { processDeliveryJob } from './webhook-delivery.js';

const checkConnector = vi.mocked(checkSerumConnectorRuntimePolicy);

const orgId = '00000000-0000-4000-8000-000000000001';
const _userId = '00000000-0000-4000-8000-000000000002';
const subscriptionId = '00000000-0000-4000-8000-000000000003';
const log = {
  child: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as pino.Logger;

const event = {
  id: '00000000-0000-4000-8000-000000000004',
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

function allowedDecision(connectorId: string, operation: string) {
  return {
    configType: 'connectors',
    configKey: 'registry',
    environment: 'dev',
    subject: `${operation}:${connectorId}`,
    allowed: true,
    status: 'allowed',
    reason: 'Connector operation is allowed by the active SERUM policy.',
    activeConfigVersionId: '00000000-0000-4000-8000-000000000099',
  };
}

function deniedDecision(connectorId: string, operation: string) {
  return {
    configType: 'connectors',
    configKey: 'registry',
    environment: 'dev',
    subject: `${operation}:${connectorId}`,
    allowed: false,
    status: 'not_configured',
    reason: 'No active SERUM Connectors policy is published.',
    activeConfigVersionId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  checkConnector.mockResolvedValue(allowedDecision('google_workspace', 'calendar.push'));
  mocks.webhookSubscriptionFindFirst.mockResolvedValue({
    id: subscriptionId,
    orgId,
    url: 'https://partner.example/webhooks/bidstack',
    secret: 'secret',
    failureCount: 0,
    lastDeliveryAt: new Date('2026-06-16T12:00:00.000Z'),
  });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('worker connector SERUM egress gates', () => {
  it('blocks Google Calendar push before provider egress or event mutation when policy denies', async () => {
    checkConnector.mockResolvedValueOnce(deniedDecision('google_workspace', 'calendar.push'));

    await expect(
      handleGooglePush({ event, operation: 'push', accessToken: 'token', log }),
    ).rejects.toThrow(/SERUM connector policy denied google_workspace calendar\.push/);

    expect(checkConnector).toHaveBeenCalledWith({
      orgId,
      environment: 'dev',
      configKey: 'registry',
      connectorId: 'google_workspace',
      operation: 'calendar.push',
      writeRequested: true,
      connectionTestProbe: false,
      approvalConfirmed: false,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.calendarEventUpdate).not.toHaveBeenCalled();
  });

  it('blocks HubSpot import page fetch before HubSpot API egress when policy denies', async () => {
    checkConnector.mockResolvedValueOnce(deniedDecision('hubspot', 'hubspot.import.companies'));

    await expect(
      fetchHubSpotPage(orgId, 'companies', 'hubspot-token', ['name', 'domain'], 25),
    ).rejects.toThrow(/SERUM connector policy denied hubspot hubspot\.import\.companies/);

    expect(checkConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId,
        connectorId: 'hubspot',
        operation: 'hubspot.import.companies',
        writeRequested: false,
      }),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('records and skips webhook delivery when policy denies instead of calling partner URL', async () => {
    checkConnector.mockResolvedValueOnce(
      deniedDecision('webhook_delivery', 'webhook.deliver.lead.created'),
    );

    await processDeliveryJob(
      {
        id: 'job-1',
        attemptsMade: 0,
        // BullMQ always stamps job.timestamp; the mock must too, else the stable
        // timestamp fallback (new Date(job.timestamp)) throws "Invalid time value".
        timestamp: new Date('2026-06-17T14:00:00.000Z').getTime(),
        data: {
          subscriptionId,
          event: 'lead.created',
          payload: { leadId: 'lead-1' },
        },
      } as never,
      log,
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.webhookDeliveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscriptionId,
        orgId,
        event: 'lead.created',
        statusCode: null,
        success: false,
        durationMs: 0,
        attempt: 1,
        errorMessage: expect.stringMatching(
          /SERUM connector policy denied webhook_delivery webhook\.deliver\.lead\.created/,
        ),
      }),
    });
    expect(mocks.webhookSubscriptionUpdate).not.toHaveBeenCalled();
  });
});
