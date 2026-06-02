import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
const createdSubscriptionIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (!orgId) return;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (dbReachable) {
    await prisma.webhookSubscription.deleteMany({ where: { id: { in: createdSubscriptionIds } } });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name} - DATABASE_URL not reachable or seed org missing`);
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

    const listed = await server.inject({
      method: 'GET',
      url: '/api/v1/webhook-subscriptions',
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain(body.signingSecret);
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
