// The SMS row is written only after Twilio accepts. A foreign contact id is
// stored on that row, and a provider failure leaves no row at all.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import { encryptToken } from '@bidstack/shared/token-crypto';

import { sendSms } from './twilio-sms.service.js';

vi.mock('../lib/serum-connector-policy.js', () => ({
  assertSerumConnectorAllowed: vi.fn().mockResolvedValue({ allowed: true }),
  recordSerumConnectorTestSuccess: vi.fn(),
}));

const log = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

let dbReachable = false;
let harborOrgId = '';
let quayOrgId = '';
let harborUserId = '';
let harborContactId = '';
let quayContactId = '';

describe('SMS entity link is checked before Twilio', () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }
    process.env.INTEGRATION_TOKEN_KEY = 'ab'.repeat(32);
    const harbor = await prisma.org.create({
      data: { clerkOrg: `org_sms_h_${Date.now()}`, name: 'Harbor Synthetic Co' },
    });
    const quay = await prisma.org.create({
      data: { clerkOrg: `org_sms_q_${Date.now()}`, name: 'Quay Synthetic Ltd' },
    });
    harborOrgId = harbor.id;
    quayOrgId = quay.id;
    const user = await prisma.user.create({
      data: {
        orgId: harbor.id,
        clerkUser: `user_sms_${harbor.id}`,
        email: `sms.${harbor.id}@harbor-synthetic.test`,
        name: 'Harbor Sender',
      },
    });
    harborUserId = user.id;
    harborContactId = (
      await prisma.contact.create({
        data: { orgId: harbor.id, customer: 'Harbor Synthetic Co', name: 'Harbor Buyer' },
        select: { id: true },
      })
    ).id;
    quayContactId = (
      await prisma.contact.create({
        data: { orgId: quay.id, customer: 'Quay Synthetic Ltd', name: 'Quay Buyer' },
        select: { id: true },
      })
    ).id;
    await prisma.integrationToken.create({
      data: {
        orgId: harbor.id,
        userId: user.id,
        provider: 'twilio',
        status: 'active',
        externalAccountId: '+15555550100',
        accessTokenEncrypted: encryptToken(
          JSON.stringify({ accountSid: 'ACsynthetic', authToken: 'synthetic-token' }),
        ),
      },
    });
  }, 30_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (harborOrgId) await prisma.org.delete({ where: { id: harborOrgId } }).catch(() => undefined);
    if (quayOrgId) await prisma.org.delete({ where: { id: quayOrgId } }).catch(() => undefined);
  });

  const ready = () => dbReachable && harborOrgId.length > 0;

  it('refuses Quay contact id and does not call Twilio', async () => {
    if (!ready()) throw new Error('[skip] SMS entity link — DATABASE_URL not reachable');
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ sid: 'SMsynthetic', num_segments: '1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendSms(
        {
          orgId: harborOrgId,
          userId: harborUserId,
          toNumber: '+15555550123',
          body: 'Harbor ping',
          entityType: 'CONTACT',
          entityId: quayContactId,
        },
        log,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await prisma.smsMessage.count({ where: { orgId: harborOrgId, entityId: quayContactId } }),
    ).toBe(0);
  });

  it('keeps the Harbor contact link when Twilio rejects the send', async () => {
    if (!ready()) throw new Error('[skip] SMS entity link — DATABASE_URL not reachable');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('twilio down');
      }),
    );

    await expect(
      sendSms(
        {
          orgId: harborOrgId,
          userId: harborUserId,
          toNumber: '+15555550124',
          body: 'Harbor ping',
          entityType: 'CONTACT',
          entityId: harborContactId,
        },
        log,
      ),
    ).rejects.toThrow(/twilio down/);

    const row = await prisma.smsMessage.findFirst({
      where: { orgId: harborOrgId, entityId: harborContactId, toNumber: '+15555550124' },
      select: { status: true, twilioSid: true },
    });
    expect(row).toMatchObject({ status: 'FAILED', twilioSid: null });
  });
});
