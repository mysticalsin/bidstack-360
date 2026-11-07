import type * as DeliveryModuleNs from './webhook-delivery.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import type pino from 'pino';

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  subFindFirst: vi.fn(),
  deliveryCreate: vi.fn(),
  subUpdate: vi.fn(),
  messageUpsert: vi.fn(),
  decrypt: vi.fn((s: string) => s),
  isLegacySecret: vi.fn(() => false),
  serumDenial: vi.fn(async () => null as string | null),
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    webhookSubscription: { findFirst: mocks.subFindFirst, update: mocks.subUpdate },
    webhookDelivery: { create: mocks.deliveryCreate },
    webhookMessage: { upsert: mocks.messageUpsert },
  },
}));
vi.mock('@bidstack/shared/server-crypto', () => ({
  decryptWebhookSigningSecret: mocks.decrypt,
  isLegacyWebhookSigningSecret: mocks.isLegacySecret,
}));
vi.mock('../lib/safe-research-fetch.js', () => ({ createResearchFetch: () => mocks.safeFetch }));
vi.mock('../lib/serum-connector-policy.js', () => ({ serumConnectorDenialMessage: mocks.serumDenial }));

type DeliveryModule = typeof DeliveryModuleNs;
// The worker config runs files with isolate: false, so a static import would
// keep whichever file loaded the module first bound to that file's mocks.
let processDeliveryJob: DeliveryModule['processDeliveryJob'];
let webhookBackoffStrategy: DeliveryModule['webhookBackoffStrategy'];
beforeAll(async () => {
  vi.resetModules();
  ({ processDeliveryJob, webhookBackoffStrategy } = await import('./webhook-delivery.js'));
});

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => log,
} as unknown as pino.Logger;

const SUB = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const REPLAY_OF = '44444444-4444-4444-8444-444444444444';
const TS = '2026-11-07T12:00:00.000Z';

type Sub = Partial<{
  url: string;
  failureCount: number;
  maxAttempts: number;
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  backoffBaseSeconds: number;
  timeoutMs: number;
  previousSecret: string | null;
  previousSecretExpiresAt: Date | null;
}>;

function job(attemptsMade = 0, sub: Sub = {}, data: Record<string, unknown> = {}): Job {
  mocks.subFindFirst.mockResolvedValue({
    id: SUB,
    orgId: ORG,
    url: 'https://partner.example.com/hook',
    secret: 'current-secret',
    failureCount: 0,
    maxAttempts: 5,
    backoffStrategy: 'exponential',
    backoffBaseSeconds: 30,
    timeoutMs: 10_000,
    previousSecret: null,
    previousSecretExpiresAt: null,
    ...sub,
  });
  return {
    id: `outbox_row_${SUB}`,
    name: 'lead.created',
    timestamp: Date.parse(TS),
    attemptsMade,
    opts: { attempts: 10 },
    data: {
      subscriptionId: SUB,
      event: 'lead.created',
      payload: { leadId: 'lead-1', token: 'tok_live_secret' },
      eventId: EVENT_ID,
      eventTimestamp: TS,
      ...data,
    },
  } as unknown as Job;
}

function response(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decrypt.mockImplementation((s: string) => s);
  mocks.deliveryCreate.mockResolvedValue({ id: 'd1' });
  mocks.subUpdate.mockResolvedValue({ id: SUB });
  mocks.messageUpsert.mockResolvedValue({ id: EVENT_ID });
});

describe('webhook delivery: stored message and attempt detail', () => {
  it('stores the message once by event id and the attempt with masked headers and a redacted, capped body', async () => {
    mocks.safeFetch.mockResolvedValue(
      response(200, JSON.stringify({ received: true, access_token: 'leak-me' }) + 'x'.repeat(9000)),
    );
    await processDeliveryJob(job(), log);

    const upsert = mocks.messageUpsert.mock.calls[0]![0];
    expect(upsert.where).toEqual({ id: EVENT_ID });
    expect(upsert.create).toMatchObject({
      id: EVENT_ID,
      orgId: ORG,
      subscriptionId: SUB,
      event: 'lead.created',
      status: 'succeeded',
      attempts: 1,
      lastStatusCode: 200,
    });
    expect(upsert.update).toMatchObject({ status: 'succeeded', attempts: 1, lastStatusCode: 200 });

    const delivery = mocks.deliveryCreate.mock.calls[0]![0].data;
    expect(delivery.messageId).toBe(EVENT_ID);
    expect(delivery.requestHeaders['X-Polo-Signature']).toMatch(/^t=\d+,v1=\*\*\*\*$/);
    expect(JSON.stringify(delivery.requestHeaders)).not.toContain('current-secret');
    expect(delivery.responseBody).not.toContain('leak-me');
    expect(Buffer.byteLength(delivery.responseBody, 'utf8')).toBeLessThanOrEqual(4096);
    expect(delivery.responseTruncated).toBe(true);
  });

  it('links a replayed message to the original', async () => {
    mocks.safeFetch.mockResolvedValue(response(204));
    await processDeliveryJob(job(0, {}, { replayOfId: REPLAY_OF }), log);
    expect(mocks.messageUpsert.mock.calls[0]![0].create).toMatchObject({ replayOfId: REPLAY_OF });
  });
});

describe('webhook delivery: per-endpoint retry policy', () => {
  it('fails a non-retryable 4xx at once instead of burning the schedule', async () => {
    mocks.safeFetch.mockResolvedValue(response(410, 'gone'));
    const err = await processDeliveryJob(job(), log).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(mocks.messageUpsert.mock.calls[0]![0].update).toMatchObject({ status: 'failed' });
  });

  it('retries a 5xx and keeps the message pending while attempts remain', async () => {
    mocks.safeFetch.mockResolvedValue(response(503));
    const err = await processDeliveryJob(job(0), log).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
    expect(mocks.messageUpsert.mock.calls[0]![0].update).toMatchObject({ status: 'pending' });
    expect((err as { retryDelayMs?: number }).retryDelayMs).toBe(30_000);
  });

  it('stops at the endpoint max attempts, not the queue ceiling', async () => {
    mocks.safeFetch.mockResolvedValue(response(500));
    const err = await processDeliveryJob(job(1, { maxAttempts: 2 }), log).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(mocks.messageUpsert.mock.calls[0]![0].update).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('uses the endpoint curve for the next delay and honours Retry-After on 429', async () => {
    mocks.safeFetch.mockResolvedValue(response(500));
    const linear = await processDeliveryJob(
      job(1, { backoffStrategy: 'linear', backoffBaseSeconds: 10 }),
      log,
    ).catch((e: unknown) => e);
    expect((linear as { retryDelayMs?: number }).retryDelayMs).toBe(20_000);

    mocks.safeFetch.mockResolvedValue(response(429, '', { 'retry-after': '90' }));
    const limited = await processDeliveryJob(job(0), log).catch((e: unknown) => e);
    expect((limited as { retryDelayMs?: number }).retryDelayMs).toBe(90_000);
    expect(webhookBackoffStrategy(1, 'webhook-endpoint', limited as Error)).toBe(90_000);
  });

  it('stops at the job attempt budget when it is lower than the endpoint policy', async () => {
    mocks.safeFetch.mockResolvedValue(response(500));
    const j = job(4, { maxAttempts: 8 });
    (j.opts as { attempts?: number }).attempts = 5;
    const err = await processDeliveryJob(j, log).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(mocks.messageUpsert.mock.calls[0]![0].update).toMatchObject({ status: 'failed', attempts: 5 });
  });

  it('keeps the timeout running while the body is read', async () => {
    mocks.safeFetch.mockImplementation(async (_url: string, init: { signal: AbortSignal }) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'));
          init.signal.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(body, { status: 200 });
    });
    const started = Date.now();
    await processDeliveryJob(job(0, { timeoutMs: 50 }), log);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(mocks.deliveryCreate.mock.calls[0]![0].data).toMatchObject({ statusCode: 200, responseBody: null });
  });

  it('auto-disables a dead endpoint on a final non-retryable failure', async () => {
    mocks.safeFetch.mockResolvedValue(response(410, 'gone'));
    await processDeliveryJob(job(0, { failureCount: 9 }), log).catch(() => undefined);
    expect(mocks.subUpdate.mock.calls[0]![0].data).toMatchObject({ active: false });
  });

  it('does not retry an unsafe URL', async () => {
    const err = await processDeliveryJob(job(0, { url: 'http://127.0.0.1/hook' }), log).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
  });

  it('falls back to the default curve when an error carries no delay', () => {
    expect(webhookBackoffStrategy(2, 'webhook-endpoint', new Error('x'))).toBe(60_000);
  });
});

describe('webhook delivery: secret rotation overlap', () => {
  it('signs with both secrets while the previous secret is inside its overlap window', async () => {
    mocks.safeFetch.mockResolvedValue(response(200));
    await processDeliveryJob(
      job(0, { previousSecret: 'old-secret', previousSecretExpiresAt: new Date(Date.now() + 60_000) }),
      log,
    );
    const header = (mocks.safeFetch.mock.calls[0]![1].headers as Record<string, string>)['X-Polo-Signature'];
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/);
  });

  it('drops the previous secret once the window has passed', async () => {
    mocks.safeFetch.mockResolvedValue(response(200));
    await processDeliveryJob(
      job(0, { previousSecret: 'old-secret', previousSecretExpiresAt: new Date(Date.now() - 1) }),
      log,
    );
    const header = (mocks.safeFetch.mock.calls[0]![1].headers as Record<string, string>)['X-Polo-Signature'];
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });
});
