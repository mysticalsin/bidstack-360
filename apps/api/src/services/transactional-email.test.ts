import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  createNotification: vi.fn(),
  reserve: vi.fn(),
  rollback: vi.fn(),
  orgSettingsFindUnique: vi.fn(),
  contactFindFirst: vi.fn(),
  companyFindFirst: vi.fn(),
  integrationFindFirst: vi.fn(),
  npsCreate: vi.fn(),
  npsUpdate: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  IntegrationProvider: { gmail: 'gmail', microsoft_graph: 'microsoft_graph' },
  prisma: {
    orgSettings: { findUnique: mocks.orgSettingsFindUnique },
    contact: { findFirst: mocks.contactFindFirst },
    company: { findFirst: mocks.companyFindFirst },
    integrationToken: { findFirst: mocks.integrationFindFirst },
    npsSurvey: { create: mocks.npsCreate, update: mocks.npsUpdate },
  },
}));

// A mailbox connected read-only refuses every send, exactly like sendEmail does.
vi.mock('./email-integration.service.js', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('./notification.service.js', () => ({ createNotification: mocks.createNotification }));
vi.mock('../lib/outbound-communication-guard.js', () => ({
  reserveOutboundCommunication: mocks.reserve,
}));
vi.mock('../queues/webhook-delivery.js', () => ({ fanOutWebhookEvent: vi.fn() }));

import { sendBookingConfirmationEmail } from '../routes/bookings.helpers.js';
import { sendNpsSurvey } from './cs/nps.service.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000002';

const booking = {
  orgId: ORG,
  userId: OWNER,
  attendeeName: 'Alice Smith',
  attendeeEmail: 'alice@example.com',
  attendeePhone: null,
  ownerName: 'Bob Jones',
  pageName: 'Intro call',
  startAt: new Date('2026-11-10T14:00:00Z'),
  endAt: new Date('2026-11-10T14:30:00Z'),
  bookingId: 'booking-1',
  cancelToken: 'cancel-token-abc',
};

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('NOTIFICATION_FROM_EMAIL', 'Polo <notifications@example.com>');
  mocks.sendEmail.mockRejectedValue(
    Object.assign(new Error('This mailbox is connected read-only. Save a draft instead.'), {
      statusCode: 409,
    }),
  );
  mocks.reserve.mockResolvedValue({ rollback: mocks.rollback });
  mocks.orgSettingsFindUnique.mockResolvedValue({ emailFromAddress: 'sales@acme.test' });
  mocks.integrationFindFirst.mockResolvedValue({ userId: OWNER, scope: ['gmail.readonly'] });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('system transactional mail', () => {
  it('booking confirmation reaches the attendee when the owner mailbox is read-only', async () => {
    const log = logger();
    await sendBookingConfirmationEmail(booking, log);

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.to).toEqual(['Alice Smith <alice@example.com>']);
    expect(body.reply_to).toBe('sales@acme.test');
    expect(body.text).toContain('cancel-token-abc');
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it('without a transactional sender the owner is told in-app and the failure is logged', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const log = logger();
    await sendBookingConfirmationEmail(booking, log);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
    expect(mocks.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG,
        userId: OWNER,
        type: 'system',
        entityType: 'booking',
        entityId: 'booking-1',
      }),
    );
  });

  it('a provider rejection is surfaced, not dropped', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"bad from"}', { status: 422 }));
    const log = logger();
    await sendBookingConfirmationEmail(booking, log);

    expect(log.error).toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalled();
    expect(mocks.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER, type: 'system', entityId: 'booking-1' }),
    );
  });

  it('NPS survey link goes out without a connected mailbox', async () => {
    mocks.integrationFindFirst.mockResolvedValue(null);
    mocks.npsCreate.mockResolvedValue({ id: 'survey-1' });
    mocks.npsUpdate.mockResolvedValue({});
    mocks.contactFindFirst.mockResolvedValue({ email: 'carol@client.test', name: 'Carol Doe' });
    mocks.companyFindFirst.mockResolvedValue({ keyAccountOwnerId: OWNER });

    await sendNpsSurvey(
      { orgId: ORG, accountId: 'acct-1', contactId: 'contact-1' },
      logger() as unknown as pino.Logger,
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.to).toEqual(['carol@client.test']);
  });
});
