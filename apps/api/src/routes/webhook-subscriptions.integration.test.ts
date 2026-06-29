import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import {
  _resetIntegrationTokenKey,
  decryptSecret,
  hashWebhookSigningSecret,
} from '@bidstack/shared/server-crypto';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let previousTokenKey: string | undefined;
let restoreAuth: (() => void) | null = null;
const createdSubscriptionIds: string[] = [];
// Deterministic 64-hex test key so the webhook signing-secret encryption path
// (encryptSecret on create) runs — prod supplies a real INTEGRATION_TOKEN_KEY.
const TEST_TOKEN_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeAll(async () => {
  previousTokenKey = process.env.INTEGRATION_TOKEN_KEY;
  process.env.INTEGRATION_TOKEN_KEY = TEST_TOKEN_KEY;
  _resetIntegrationTokenKey();
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('webhook-subscriptions');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (dbReachable) {
    await prisma.webhookSubscription.deleteMany({ where: { id: { in: createdSubscriptionIds } } });
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousTokenKey === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
  else process.env.INTEGRATION_TOKEN_KEY = previousTokenKey;
  _resetIntegrationTokenKey();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name} - DATABASE_URL not reachable or isolated org missing`);
    }
    await fn();
  });

describe('webhook subscription routes', () => {
  skipIfNoDb('POST /api/webhook-subscriptions returns a one-time signing secret', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/webhook-subscriptions',
      payload: {
        url: 'https://example.com/bidstack-webhook-secret',
        events: ['lead.created'],
        active: true,
      },
    });

    expect(created.statusCode).toBe(201);
    const body = created.json() as { id: string; signingSecret: string };
    createdSubscriptionIds.push(body.id);
    expect(body.signingSecret).toMatch(/^whsec_/);

    const stored = await prisma.webhookSubscription.findUnique({
      where: { id: body.id },
      select: { secret: true, secretHash: true },
    });
    expect(stored?.secret).toBeTruthy();
    expect(stored?.secret).not.toBe(body.signingSecret);
    expect(decryptSecret(stored!.secret)).toBe(body.signingSecret);
    expect(stored?.secretHash).toBe(hashWebhookSigningSecret(body.signingSecret));

    const listed = await server.inject({
      method: 'GET',
      url: '/api/v1/webhook-subscriptions',
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain(body.signingSecret);

    const audit = await prisma.auditLog.findFirst({
      where: {
        orgId: orgId!,
        action: 'webhook_subscription.create',
        targetId: body.id,
      },
    });
    expect(audit?.diff).toMatchObject({
      active: true,
      events: ['lead.created'],
      urlHost: 'example.com',
    });
  });

  skipIfNoDb('POST /api/webhook-subscriptions rejects unsupported event names', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/webhook-subscriptions',
      payload: {
        url: 'https://example.com/bidstack-webhook-invalid-event',
        events: ['fake.placeholder'],
        active: true,
      },
    });

    expect(created.statusCode).toBe(400);
  });

  skipIfNoDb('POST /api/webhook-subscriptions rejects API-key write actors', async () => {
    const rawKey = `bs_test_webhook_${randomUUID()}`;
    const apiKey = await prisma.apiKey.create({
      data: {
        orgId: orgId!,
        name: 'Webhook settings route regression key',
        prefix: rawKey.slice(0, 8),
        hashedKey: createHash('sha256').update(rawKey).digest('hex'),
        scopes: ['read', 'write'],
      },
    });

    try {
      const created = await server.inject({
        method: 'POST',
        url: '/api/v1/webhook-subscriptions',
        headers: { 'x-api-key': rawKey },
        payload: {
          url: 'https://example.com/bidstack-webhook-api-key-denied',
          events: ['lead.created'],
          active: true,
        },
      });

      expect(created.statusCode).toBe(403);
      expect(created.json()).toMatchObject({
        message: 'Webhook subscription writes require a user session',
      });
    } finally {
      await prisma.apiKey.delete({ where: { id: apiKey.id } });
    }
  });

  skipIfNoDb('PATCH /api/webhook-subscriptions/:id rejects private URLs', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/webhook-subscriptions',
      payload: {
        url: 'https://example.com/bidstack-webhook',
        events: ['opportunity.stage_changed'],
        active: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    createdSubscriptionIds.push(id);

    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/v1/webhook-subscriptions/${id}`,
      payload: { url: 'https://127.0.0.1/webhook' },
    });

    expect(patch.statusCode).toBe(400);
    expect(patch.json()).toMatchObject({
      message: 'url must not point to a private or internal address',
    });
  });
});
