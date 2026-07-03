import type IORedis from 'ioredis';
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { processSingleSend } from './sms.js';

// WHY mock the DB: the idempotency guard's whole point is to control whether the
// row is created (send path) vs. upserted (crash-recovery path). We assert on
// which call fires, so the Prisma client is fully stubbed.
vi.mock('@bidstack/db', () => ({
  prisma: {
    smsConsent: { findUnique: vi.fn() },
    integrationToken: { findFirst: vi.fn() },
    smsMessage: { create: vi.fn(), upsert: vi.fn() },
  },
}));

// The decrypted token must JSON-parse into Twilio creds; the real crypto is
// irrelevant to the idempotency contract under test.
vi.mock('@bidstack/shared/token-crypto', () => ({
  decryptToken: () => JSON.stringify({ accountSid: 'AC', authToken: 'tok' }),
}));

const consentFind = vi.mocked(prisma.smsConsent.findUnique);
const tokenFind = vi.mocked(prisma.integrationToken.findFirst);
const messageCreate = vi.mocked(prisma.smsMessage.create);
const messageUpsert = vi.mocked(prisma.smsMessage.upsert);

const log = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as pino.Logger;

const orgId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const integrationTokenId = '00000000-0000-4000-8000-000000000003';

const jobData = {
  orgId,
  userId,
  integrationTokenId,
  toNumber: '+15557654321',
  body: 'Hello from Polo PreSales',
};

/**
 * Minimal in-memory IORedis stub honoring exactly the three ops the guard uses.
 * `set` respects NX (returns 'OK' only when the key is absent) so a pre-seeded
 * claim makes the second attempt see `null` — the same signal a real Redis gives
 * BullMQ on a retry after a prior send.
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

function twilioOkResponse(): Response {
  return {
    ok: true,
    json: async () => ({ sid: 'SM123', num_segments: '1' }),
  } as unknown as Response;
}

beforeEach(() => {
  // Default: recipient has consent (no opt-out) and a valid Twilio token exists.
  consentFind.mockResolvedValue(null as never);
  tokenFind.mockResolvedValue({
    accessTokenEncrypted: 'x',
    externalAccountId: '+15550001111',
  } as never);
  messageCreate.mockResolvedValue({} as never);
  messageUpsert.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('processSingleSend idempotency', () => {
  it('first attempt sends once and records the row', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(twilioOkResponse());
    const redis = makeFakeRedis();

    await processSingleSend(jobData, 'job-1', redis.connection, log);

    // The send is the paid side-effect — it must fire exactly once.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(messageCreate).toHaveBeenCalledTimes(1);
    expect(messageUpsert).not.toHaveBeenCalled();
    // Claim flips from 'pending' to 'sent:<sid>' before the DB write.
    expect(redis.store.get('sms:claim:job-1')).toBe('sent:SM123');
  });

  it('retry of the same jobId after a prior successful send does NOT call Twilio again', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(twilioOkResponse());
    // Pre-seed the claim as a prior attempt would have left it post-send.
    const redis = makeFakeRedis({ 'sms:claim:job-1': 'sent:SM123' });

    await processSingleSend(jobData, 'job-1', redis.connection, log);

    // This is the bug-regression guard: a second invocation of the SAME jobId
    // must NOT re-hit Twilio (would be a duplicate text / TCPA + double-bill).
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(messageCreate).not.toHaveBeenCalled();
    // It reconciles the (possibly lost) DB row by twilioSid instead.
    expect(messageUpsert).toHaveBeenCalledTimes(1);
    expect(messageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { twilioSid: 'SM123' } }),
    );
  });

  it('a send failure releases the claim so a retry can resend', async () => {
    const redis = makeFakeRedis();
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network down'));

    await expect(
      processSingleSend(jobData, 'job-1', redis.connection, log),
    ).rejects.toThrow('network down');

    // Twilio never accepted → the claim is freed so a legitimate retry is allowed.
    expect(redis.del).toHaveBeenCalledWith('sms:claim:job-1');
    expect(redis.store.has('sms:claim:job-1')).toBe(false);
    expect(messageCreate).not.toHaveBeenCalled();

    // The retry (fresh fetch result) now sends and records normally.
    fetchSpy.mockResolvedValue(twilioOkResponse());
    await processSingleSend(jobData, 'job-1', redis.connection, log);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(messageCreate).toHaveBeenCalledTimes(1);
  });

  // WHY this test: the job payload is the only provenance for integrationTokenId,
  // so the token lookup must be scoped { id, orgId }. Without it, a forged/stale
  // id in a job payload could decrypt another org's Twilio credentials and send
  // on their account — cross-tenant OAuth token disclosure.
  it('a token id belonging to another org is not returned or decrypted', async () => {
    // Org-scoped findFirst finds no row when the id exists under a different org.
    tokenFind.mockResolvedValue(null as never);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(twilioOkResponse());
    const redis = makeFakeRedis();

    await expect(
      processSingleSend(jobData, 'job-1', redis.connection, log),
    ).rejects.toThrow(`IntegrationToken ${integrationTokenId} not found`);

    expect(tokenFind).toHaveBeenCalledWith({
      where: { id: integrationTokenId, orgId },
      select: { accessTokenEncrypted: true, externalAccountId: true },
    });
    // No creds → no claim, no Twilio call, no row.
    expect(redis.set).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it('opted-out recipient is skipped before any claim or send', async () => {
    consentFind.mockResolvedValue({ optedOut: true } as never);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(twilioOkResponse());
    const redis = makeFakeRedis();

    await processSingleSend(jobData, 'job-1', redis.connection, log);

    // Consent gate must short-circuit before the claim is ever set.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(messageCreate).not.toHaveBeenCalled();
    expect(messageUpsert).not.toHaveBeenCalled();
  });
});
