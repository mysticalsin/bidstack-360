import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import type pino from 'pino';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// We mock the I/O boundaries (prisma, the SSRF-safe fetch, secret decryption, the
// SERUM policy) but keep `assertSafeWebhookUrl` REAL so the SSRF test proves the
// production guard rejects a private host before any fetch is attempted.

const mocks = vi.hoisted(() => ({
  // The fetch returned by createResearchFetch — controllable per test.
  safeFetch: vi.fn(),
  subFindFirst: vi.fn(),
  deliveryCreate: vi.fn(),
  subUpdate: vi.fn(),
  decrypt: vi.fn((s: string) => s),
  isLegacySecret: vi.fn((s: string) => s.startsWith('whsec_')),
  serumDenial: vi.fn(async () => null as string | null),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    webhookSubscription: { findFirst: mocks.subFindFirst, update: mocks.subUpdate },
    webhookDelivery: { create: mocks.deliveryCreate },
  },
}));

vi.mock('@bidstack/shared/server-crypto', () => ({
  decryptWebhookSigningSecret: mocks.decrypt,
  isLegacyWebhookSigningSecret: mocks.isLegacySecret,
}));

// createResearchFetch is called at module load (`const safeFetch = ...`), so the
// factory must return our controllable double.
vi.mock('../lib/safe-research-fetch.js', () => ({
  createResearchFetch: () => mocks.safeFetch,
}));

vi.mock('../lib/serum-connector-policy.js', () => ({
  serumConnectorDenialMessage: mocks.serumDenial,
}));

import { processDeliveryJob } from './webhook-delivery.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => log,
} as unknown as pino.Logger;

const SUBSCRIPTION_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'whsec_test_fixture';
// Fixed enqueue time so the signature `t` is deterministic across the test.
const JOB_TS = 1_700_000_000_000;
const EXPECTED_T = Math.floor(JOB_TS / 1000);

function jobOf(
  overrides: Partial<{ url: string; attemptsMade: number; failureCount: number }> = {},
): Job<{ subscriptionId: string; event: string; payload: Record<string, unknown> }> {
  const { url = 'https://partner.example.com/hook', attemptsMade = 0 } = overrides;
  mocks.subFindFirst.mockResolvedValue({
    id: SUBSCRIPTION_ID,
    orgId: ORG_ID,
    url,
    secret: SECRET,
    failureCount: overrides.failureCount ?? 0,
  });
  return {
    id: `lead.created:${SUBSCRIPTION_ID}:${JOB_TS}`,
    name: `lead.created:${SUBSCRIPTION_ID}`,
    timestamp: JOB_TS,
    attemptsMade,
    data: {
      subscriptionId: SUBSCRIPTION_ID,
      event: 'lead.created',
      payload: { leadId: 'lead-1' },
    },
  } as unknown as Job<{
    subscriptionId: string;
    event: string;
    payload: Record<string, unknown>;
  }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decrypt.mockImplementation((s: string) => s);
  mocks.isLegacySecret.mockImplementation((s: string) => s.startsWith('whsec_'));
  mocks.serumDenial.mockResolvedValue(null);
  mocks.deliveryCreate.mockResolvedValue({ id: 'del-1' });
  mocks.subUpdate.mockResolvedValue({ id: SUBSCRIPTION_ID });
});

describe('processDeliveryJob — HMAC signature contract', () => {
  // WHY: partners verify authenticity by recomputing HMAC-SHA256 over the exact
  // documented `${t}.${body}` string (see /docs/api/webhooks.md). If the worker
  // signed anything else, every partner signature check would fail — breaking the
  // whole webhook trust model. This test pins that exact construction.
  it('signs HMAC-SHA256 over the documented `${t}.${body}` string', async () => {
    mocks.safeFetch.mockResolvedValue({ status: 200 } as Response);

    await processDeliveryJob(jobOf(), log);

    expect(mocks.safeFetch).toHaveBeenCalledTimes(1);
    const [, init] = mocks.safeFetch.mock.calls[0]!;
    const sentBody = init.body as string;
    const header = (init.headers as Record<string, string>)['X-Polo PreSales-Signature'];

    const m = header.match(/^t=(\d+),v1=([0-9a-f]+)$/);
    expect(m).not.toBeNull();
    const [, tStr, v1] = m!;

    // `t` is derived from the stable enqueue timestamp, not the wall clock.
    expect(Number(tStr)).toBe(EXPECTED_T);

    const expected = createHmac('sha256', SECRET).update(`${tStr}.${sentBody}`).digest('hex');
    expect(v1).toBe(expected);
    // Cross-check: signing over a DIFFERENT string would NOT match — proves the
    // assertion can fail when the construction changes.
    const wrong = createHmac('sha256', SECRET).update(sentBody).digest('hex');
    expect(v1).not.toBe(wrong);
  });

  it('reuses the stable event id + timestamp from the job (retry-safe dedup)', async () => {
    mocks.safeFetch.mockResolvedValue({ status: 200 } as Response);

    // Two attempts of the SAME job (same id/timestamp) must produce an identical
    // event body — the property partner-side dedup keys on across retries.
    await processDeliveryJob(jobOf({ attemptsMade: 0 }), log);
    await processDeliveryJob(jobOf({ attemptsMade: 1 }), log);

    const bodyA = JSON.parse(mocks.safeFetch.mock.calls[0]![1].body as string);
    const bodyB = JSON.parse(mocks.safeFetch.mock.calls[1]![1].body as string);
    expect(bodyA.id).toBe(bodyB.id);
    expect(bodyA.timestamp).toBe(bodyB.timestamp);
  });
});

describe('processDeliveryJob — SSRF guard', () => {
  // WHY: a partner could (maliciously or by mistake) register a URL pointing at
  // internal infrastructure (169.254.169.254 metadata, localhost, RFC-1918). The
  // delivery worker MUST reject it BEFORE issuing the fetch, or it becomes an SSRF
  // pivot. This test proves the guard fires and no network call is made.
  it('rejects a private/internal host before fetch and records a failed delivery', async () => {
    const job = jobOf({ url: 'https://169.254.169.254/latest/meta-data' });

    // The job throws so BullMQ retries — but crucially fetch is never called.
    await expect(processDeliveryJob(job, log)).rejects.toThrow();

    expect(mocks.safeFetch).not.toHaveBeenCalled();
    expect(mocks.deliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: false,
          statusCode: null,
          errorMessage: expect.stringContaining('Unsafe webhook URL'),
        }),
      }),
    );
  });
});

describe('processDeliveryJob - signing-secret safety', () => {
  // WHY: legacy webhook rows must be backfilled instead of silently signing
  // partner traffic with arbitrary plaintext after an unreadable/corrupt secret.
  // A decrypt failure is also deterministic — retrying can never fix it — so
  // the job must fail as UnrecoverableError instead of burning BullMQ's
  // 5-attempt/~1.5h retry schedule before the subscription silently
  // auto-disables.
  it('throws UnrecoverableError with a backfill message when legacy plaintext fallback is disabled', async () => {
    const job = jobOf();
    mocks.isLegacySecret.mockReturnValue(true);
    mocks.decrypt.mockImplementation(() => {
      throw new Error('legacy plaintext disabled');
    });

    const err: unknown = await processDeliveryJob(job, log).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as Error).message).toContain('run the webhook secret encryption backfill');

    expect(mocks.safeFetch).not.toHaveBeenCalled();
    expect(mocks.deliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: false,
          statusCode: null,
          errorMessage: expect.stringContaining('run the webhook secret encryption backfill'),
        }),
      }),
    );
    // The failure row + failureCount bookkeeping still happens as before —
    // only the retry decision changes.
    expect(mocks.subUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SUBSCRIPTION_ID },
        data: expect.objectContaining({ failureCount: { increment: 1 } }),
      }),
    );
  });

  it('throws UnrecoverableError with a key-mismatch message when the secret is not legacy plaintext', async () => {
    const job = jobOf();
    mocks.isLegacySecret.mockReturnValue(false);
    mocks.decrypt.mockImplementation(() => {
      throw new Error('bad ciphertext');
    });

    const err: unknown = await processDeliveryJob(job, log).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as Error).message).toContain('backfill will not fix this');

    expect(mocks.deliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: false,
          statusCode: null,
          errorMessage: expect.stringContaining('backfill will not fix this'),
        }),
      }),
    );
  });
});

describe('processDeliveryJob — auto-disable threshold', () => {
  // WHY: auto-disable is a destructive action (it silences a partner integration).
  // It must fire ONLY when BOTH guards trip — failureCount has reached the cap
  // (>=10) AND BullMQ has exhausted the retry schedule (attempt >=5). Disabling
  // earlier would kill integrations on a transient outage; never disabling would
  // let dead endpoints accumulate forever. These tests pin both edges.
  it('does NOT auto-disable when failureCount is below the cap', async () => {
    mocks.safeFetch.mockResolvedValue({ status: 500 } as Response);
    // failureCount 8 → becomes 9 (<10); attempt 5. Below the cap → stays active.
    const job = jobOf({ failureCount: 8, attemptsMade: 4 });

    await expect(processDeliveryJob(job, log)).rejects.toThrow();

    expect(mocks.subUpdate).toHaveBeenCalledTimes(1);
    const update = mocks.subUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(update.data).not.toHaveProperty('active');
  });

  it('does NOT auto-disable when the cap is reached but retries are not exhausted', async () => {
    mocks.safeFetch.mockResolvedValue({ status: 500 } as Response);
    // failureCount 9 → becomes 10 (>=10) BUT attempt is 3 (<5) → not yet exhausted.
    const job = jobOf({ failureCount: 9, attemptsMade: 2 });

    await expect(processDeliveryJob(job, log)).rejects.toThrow();

    const update = mocks.subUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(update.data).not.toHaveProperty('active');
  });

  it('auto-disables ONLY when failureCount >=10 AND attempt >=5', async () => {
    mocks.safeFetch.mockResolvedValue({ status: 500 } as Response);
    // failureCount 9 → becomes 10 (>=10) AND attempt 5 (>=5) → disable.
    const job = jobOf({ failureCount: 9, attemptsMade: 4 });

    await expect(processDeliveryJob(job, log)).rejects.toThrow();

    const update = mocks.subUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({ active: false });
  });
});
