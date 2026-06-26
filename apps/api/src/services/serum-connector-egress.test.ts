import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkSerumConnectorRuntimePolicy } from '@bidstack/db/serum-runtime-policy';

const mocks = vi.hoisted(() => ({
  activityCreate: vi.fn(),
  decryptToken: vi.fn(),
  getAccessToken: vi.fn(),
  integrationFindFirst: vi.fn(),
  integrationFindUnique: vi.fn(),
  sendViaGmail: vi.fn(),
  sendViaMsGraph: vi.fn(),
  smsConsentFindUnique: vi.fn(),
  smsMessageCreate: vi.fn(),
  slackUserMappingFindUnique: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  EmailProvider: {
    GMAIL: 'GMAIL',
    OUTLOOK: 'OUTLOOK',
  },
  IntegrationProvider: {
    gmail: 'gmail',
    microsoft_graph: 'microsoft_graph',
    slack: 'slack',
  },
  prisma: {
    $transaction: mocks.transaction,
    activity: {
      create: mocks.activityCreate,
    },
    integrationToken: {
      findFirst: mocks.integrationFindFirst,
      findUnique: mocks.integrationFindUnique,
    },
    slackUserMapping: {
      findUnique: mocks.slackUserMappingFindUnique,
    },
    smsConsent: {
      findUnique: mocks.smsConsentFindUnique,
    },
    smsMessage: {
      create: mocks.smsMessageCreate,
    },
  },
}));

vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: {
    connectors: 'registry',
  },
  checkSerumConnectorRuntimePolicy: vi.fn(),
  recordSerumConnectorConnectionTest: vi.fn(),
}));

vi.mock('@bidstack/shared/token-crypto', () => ({
  decryptToken: mocks.decryptToken,
}));

vi.mock('./email-integration.helpers.js', () => ({
  getAccessToken: mocks.getAccessToken,
}));

vi.mock('./email-integration.gmail.js', () => ({
  pullGmail: vi.fn(),
  sendViaGmail: mocks.sendViaGmail,
}));

vi.mock('./email-integration.graph.js', () => ({
  pullMsGraphMail: vi.fn(),
  sendViaMsGraph: mocks.sendViaMsGraph,
}));

import { sendEmail } from './email-integration.service.js';
import { postMessage } from './slack.service.js';
import { sendSms } from './twilio-sms.service.js';

const checkConnector = vi.mocked(checkSerumConnectorRuntimePolicy);

const orgId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const log = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as pino.Logger;

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
  checkConnector.mockResolvedValue(allowedDecision('gmail', 'email.send'));
  mocks.decryptToken.mockReturnValue('decrypted-token');
  mocks.getAccessToken.mockResolvedValue('access-token');
  mocks.integrationFindFirst.mockResolvedValue({
    id: 'token-1',
    orgId,
    userId,
    provider: 'gmail',
    status: 'active',
    accessTokenEncrypted: 'encrypted-token',
    externalAccountEmail: 'seller@example.com',
  });
  mocks.smsConsentFindUnique.mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API connector SERUM egress gates', () => {
  it('blocks Slack posting before token lookup or Slack API egress when policy denies', async () => {
    checkConnector.mockResolvedValueOnce(deniedDecision('slack', 'slack.postMessage'));

    const result = await postMessage({
      orgId,
      channelId: 'C123',
      blocks: [],
      text: 'policy test',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SERUM connector policy denied slack slack\.postMessage/);
    expect(checkConnector).toHaveBeenCalledWith({
      orgId,
      environment: 'dev',
      configKey: 'registry',
      connectorId: 'slack',
      operation: 'slack.postMessage',
      writeRequested: true,
      connectionTestProbe: false,
      approvalConfirmed: false,
    });
    expect(mocks.integrationFindFirst).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('blocks Twilio SMS before credentials or Twilio API egress when policy denies', async () => {
    checkConnector.mockResolvedValueOnce(deniedDecision('twilio_sms', 'sms.send'));

    await expect(
      sendSms(
        {
          orgId,
          userId,
          toNumber: '+15551234567',
          body: 'Hello',
        },
        log,
      ),
    ).rejects.toThrow(/SERUM connector policy denied twilio_sms sms\.send/);

    expect(mocks.smsConsentFindUnique).toHaveBeenCalledWith({
      where: { orgId_phoneNumber: { orgId, phoneNumber: '+15551234567' } },
      select: { optedOut: true },
    });
    expect(mocks.integrationFindFirst).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('blocks Gmail send before OAuth refresh, vendor egress, or persistence when policy denies', async () => {
    checkConnector.mockResolvedValueOnce(deniedDecision('gmail', 'email.send'));

    await expect(
      sendEmail(
        {
          orgId,
          userId,
          to: [{ email: 'buyer@example.com' }],
          subject: 'Proposal',
          text: 'Review attached',
        },
        log,
      ),
    ).rejects.toThrow(/SERUM connector policy denied gmail email\.send/);

    expect(mocks.integrationFindFirst).toHaveBeenCalledOnce();
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
    expect(mocks.sendViaGmail).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
