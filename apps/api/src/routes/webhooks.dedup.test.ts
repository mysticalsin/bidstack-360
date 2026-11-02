import { createHmac, randomUUID } from 'node:crypto';

import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redisSet: vi.fn(),
  syncCreate: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('../redis.js', () => ({
  redis: {
    set: mocks.redisSet,
  },
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    webhookSubscription: { findFirst: mocks.findFirst },
    org: { findUnique: mocks.findUnique },
    syncEvent: { create: mocks.syncCreate },
  },
}));

import { webhooksRoutes } from './webhooks.js';

const SECRET = 'dust-webhook-test-secret';

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

async function postDust(env: NodeJS.ProcessEnv, eventId = `evt_${randomUUID()}`) {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFailClosed = process.env.IDEMPOTENCY_FAIL_CLOSED;
  const previousSecret = process.env.DUST_WEBHOOK_SECRET;
  process.env.NODE_ENV = env.NODE_ENV;
  if (env.IDEMPOTENCY_FAIL_CLOSED === undefined) delete process.env.IDEMPOTENCY_FAIL_CLOSED;
  else process.env.IDEMPOTENCY_FAIL_CLOSED = env.IDEMPOTENCY_FAIL_CLOSED;
  process.env.DUST_WEBHOOK_SECRET = SECRET;

  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(webhooksRoutes, { prefix: '/webhooks' });

  const body = JSON.stringify({ metadata: { orgId: 'org-1' } });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/dust',
      headers: {
        'content-type': 'application/json',
        'x-dust-signature': sign(body),
        'x-dust-event': 'document.created',
        'x-dust-event-id': eventId,
        'x-dust-timestamp': String(Date.now()),
      },
      payload: body,
    });
    return res;
  } finally {
    await app.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousFailClosed === undefined) delete process.env.IDEMPOTENCY_FAIL_CLOSED;
    else process.env.IDEMPOTENCY_FAIL_CLOSED = previousFailClosed;
    if (previousSecret === undefined) delete process.env.DUST_WEBHOOK_SECRET;
    else process.env.DUST_WEBHOOK_SECRET = previousSecret;
  }
}

describe('dust webhook idempotency store', () => {
  beforeEach(() => {
    mocks.redisSet.mockReset();
    mocks.syncCreate.mockReset();
    mocks.findFirst.mockReset();
    mocks.findUnique.mockReset();
    mocks.redisSet.mockRejectedValue(new Error('ECONNREFUSED'));
    mocks.findFirst.mockResolvedValue({ orgId: 'org-1' });
    mocks.findUnique.mockResolvedValue({ id: 'org-1', clerkOrg: 'org_clerk_1' });
    mocks.syncCreate.mockResolvedValue({ id: 'sync-1' });
  });

  it('refuses the delivery when the idempotency store is down in production', async () => {
    // WHY: a Redis outage used to accept the webhook into a per-process map
    // and return 200. Dust then stops retrying, and another replica can
    // apply the same event again.
    const res = await postDust({ NODE_ENV: 'production' });
    expect(res.statusCode).toBe(503);
    expect(mocks.syncCreate).not.toHaveBeenCalled();
  });

  it('still refuses a production delivery when fail-open is requested', async () => {
    for (const explicit of ['false', '0']) {
      mocks.syncCreate.mockClear();
      const res = await postDust({
        NODE_ENV: 'production',
        IDEMPOTENCY_FAIL_CLOSED: explicit,
      });
      expect(res.statusCode).toBe(503);
      expect(mocks.syncCreate).not.toHaveBeenCalled();
    }
  });

  it('refuses a development delivery when the idempotency store is down', async () => {
    // WHY: preview and local API run as development. A Redis outage there
    // used to persist the event without a shared dedup record.
    const res = await postDust({ NODE_ENV: 'development' });
    expect(res.statusCode).toBe(503);
    expect(mocks.syncCreate).not.toHaveBeenCalled();
  });

  it('persists a development delivery only when fail-open is explicit', async () => {
    const eventId = `evt_${randomUUID()}`;
    const first = await postDust(
      { NODE_ENV: 'development', IDEMPOTENCY_FAIL_CLOSED: 'false' },
      eventId,
    );
    expect(first.statusCode).toBe(200);
    expect(mocks.syncCreate).toHaveBeenCalledOnce();

    const second = await postDust(
      { NODE_ENV: 'development', IDEMPOTENCY_FAIL_CLOSED: 'false' },
      eventId,
    );
    expect(second.statusCode).toBe(200);
    expect(mocks.syncCreate).toHaveBeenCalledOnce();
  });
});
