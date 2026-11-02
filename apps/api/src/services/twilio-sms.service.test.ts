import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
      this.name = 'PrismaClientKnownRequestError';
    }
  }

  return {
    PrismaClientKnownRequestError,
    activityCreate: vi.fn(),
    contactFindFirst: vi.fn(),
    decryptToken: vi.fn(),
    integrationFindFirst: vi.fn(),
    reserveOutboundCommunication: vi.fn(),
    smsConsentUpsert: vi.fn(),
    smsMessageCreate: vi.fn(),
    userFindFirst: vi.fn(),
  };
});

vi.mock('@bidstack/db', () => ({
  Prisma: {
    PrismaClientKnownRequestError: mocks.PrismaClientKnownRequestError,
  },
  prisma: {
    activity: {
      create: mocks.activityCreate,
    },
    contact: {
      findFirst: mocks.contactFindFirst,
    },
    integrationToken: {
      findFirst: mocks.integrationFindFirst,
    },
    smsConsent: {
      upsert: mocks.smsConsentUpsert,
    },
    smsMessage: {
      create: mocks.smsMessageCreate,
    },
    user: {
      findFirst: mocks.userFindFirst,
    },
  },
}));

vi.mock('@bidstack/shared/token-crypto', () => ({
  decryptToken: mocks.decryptToken,
}));

vi.mock('../lib/serum-connector-policy.js', () => ({
  assertSerumConnectorAllowed: vi.fn(),
  recordSerumConnectorTestSuccess: vi.fn(),
}));

vi.mock('../lib/outbound-communication-guard.js', () => ({
  estimateSmsSegments: (body: string) => Math.ceil(Math.max(body.length, 1) / 160),
  outboundCommunicationCapConfig: () => ({ smsEstimatedSegmentCostMicros: 8_000n }),
  reserveOutboundCommunication: mocks.reserveOutboundCommunication,
}));

import { handleInboundSms, validateTwilioSignature } from './twilio-sms.service.js';

const orgId = '00000000-0000-4000-8000-000000000001';
const adminUserId = '00000000-0000-4000-8000-000000000002';
const tokenId = '00000000-0000-4000-8000-000000000003';
const contactId = '00000000-0000-4000-8000-000000000004';

const payload = {
  MessageSid: 'SM_INBOUND_123',
  From: '+15551234567',
  To: '+15557654321',
  Body: 'Need the updated proposal',
  NumSegments: '2',
};

const log = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contactFindFirst.mockResolvedValue({ id: contactId });
  mocks.integrationFindFirst.mockResolvedValue({ id: tokenId });
  mocks.userFindFirst.mockResolvedValue({ id: adminUserId });
  mocks.smsMessageCreate.mockResolvedValue({ id: 'sms-1' });
  mocks.activityCreate.mockResolvedValue({ id: 'activity-1' });
  mocks.smsConsentUpsert.mockResolvedValue({ id: 'consent-1' });
  mocks.reserveOutboundCommunication.mockResolvedValue({ rollback: vi.fn() });
  mocks.decryptToken.mockReturnValue(
    JSON.stringify({ accountSid: 'AC123', authToken: 'twilio-secret' }),
  );
});

describe('handleInboundSms', () => {
  it('persists a first inbound SMS against the Twilio token that owns the receiving number', async () => {
    await handleInboundSms(orgId, payload, log);

    expect(mocks.integrationFindFirst).toHaveBeenCalledWith({
      where: { orgId, provider: 'twilio', status: 'active', externalAccountId: payload.To },
      select: { id: true },
    });
    expect(mocks.smsMessageCreate).toHaveBeenCalledWith({
      data: {
        orgId,
        userId: adminUserId,
        integrationTokenId: tokenId,
        fromNumber: payload.From,
        toNumber: payload.To,
        body: payload.Body,
        status: 'DELIVERED',
        twilioSid: payload.MessageSid,
        segments: 2,
        sentAt: expect.any(Date),
        deliveredAt: expect.any(Date),
        entityType: 'CONTACT',
        entityId: contactId,
      },
    });
    expect(mocks.activityCreate).toHaveBeenCalledOnce();
  });

  it('treats an exact Twilio retry as idempotent and does not duplicate CRM activity', async () => {
    mocks.smsMessageCreate.mockRejectedValueOnce(new mocks.PrismaClientKnownRequestError('P2002'));

    await expect(handleInboundSms(orgId, payload, log)).resolves.toBeUndefined();

    expect(mocks.smsMessageCreate).toHaveBeenCalledOnce();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      { MessageSid: payload.MessageSid, From: payload.From },
      'Inbound SMS duplicate ignored',
    );
  });

  it('keeps STOP keyword handling idempotent through consent upsert only', async () => {
    await handleInboundSms(orgId, { ...payload, Body: ' STOP please ' }, log);

    expect(mocks.smsConsentUpsert).toHaveBeenCalledWith({
      where: { orgId_phoneNumber: { orgId, phoneNumber: payload.From } },
      create: {
        orgId,
        phoneNumber: payload.From,
        optedOut: true,
        optedOutAt: expect.any(Date),
        source: 'STOP_KEYWORD',
      },
      update: { optedOut: true, optedOutAt: expect.any(Date), source: 'STOP_KEYWORD' },
    });
    expect(mocks.integrationFindFirst).not.toHaveBeenCalled();
    expect(mocks.smsMessageCreate).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it('validates webhook signatures with the explicit Twilio number when provided', async () => {
    mocks.integrationFindFirst.mockResolvedValueOnce({
      id: tokenId,
      accessTokenEncrypted: 'encrypted-token',
      externalAccountId: payload.To,
    });

    const url = 'https://crm.example.com/api/v1/integrations/twilio/webhook/inbound';
    const params = {
      Body: payload.Body,
      From: payload.From,
      MessageSid: payload.MessageSid,
      To: payload.To,
    };
    const signed = `${url}${Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key as keyof typeof params], '')}`;
    const signature = createHmac('sha1', 'twilio-secret').update(signed).digest('base64');

    await expect(validateTwilioSignature(orgId, signature, url, params, payload.To)).resolves.toBe(
      true,
    );

    expect(mocks.integrationFindFirst).toHaveBeenCalledWith({
      where: {
        orgId,
        provider: 'twilio',
        status: 'active',
        externalAccountId: payload.To,
      },
      select: { id: true, accessTokenEncrypted: true, externalAccountId: true },
    });
  });
});
