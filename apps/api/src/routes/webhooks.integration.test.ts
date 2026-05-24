import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let previousSecret: string | undefined;
const createdSubscriptionIds: string[] = [];
const createdOrgIds: string[] = [];
const eventTypes: string[] = [];

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function postDustWebhook(payload: Record<string, unknown>, secret: string, eventType: string) {
  const body = JSON.stringify(payload);
  return server.inject({
    method: 'POST',
    url: '/webhooks/dust',
    headers: {
      'content-type': 'application/json',
      'x-dust-signature': sign(body, secret),
      'x-dust-event': eventType,
      'x-dust-event-id': `evt_${randomUUID()}`,
      'x-dust-timestamp': String(Date.now()),
    },
    payload: body,
  });
}

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

  previousSecret = process.env.DUST_WEBHOOK_SECRET;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (dbReachable) {
    await prisma.syncEvent.deleteMany({ where: { eventType: { in: eventTypes } } });
    await prisma.webhookSubscription.deleteMany({ where: { id: { in: createdSubscriptionIds } } });
    await prisma.org.deleteMany({ where: { id: { in: createdOrgIds } } });
  }
  if (previousSecret === undefined) delete process.env.DUST_WEBHOOK_SECRET;
  else process.env.DUST_WEBHOOK_SECRET = previousSecret;
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      console.warn(`[skip] ${name} - DATABASE_URL not reachable or seed org missing`);
      return;
    }
    await fn();
  });

describe('Dust webhook receiver', () => {
  skipIfNoDb('ignores deleted subscriptions when resolving the signed webhook org', async () => {
    const secret = `whsec_${randomUUID()}`;
    process.env.DUST_WEBHOOK_SECRET = secret;
    const eventType = `test.deleted-subscription.${randomUUID()}`;
    eventTypes.push(eventType);

    const active = await prisma.webhookSubscription.create({
      data: {
        orgId: orgId!,
        url: 'https://example.com/webhook',
        secret,
        events: ['document.created'],
        active: true,
      },
    });
    createdSubscriptionIds.push(active.id);

    const foreignOrg = await prisma.org.create({
      data: { clerkOrg: `org_deleted_${randomUUID()}`, name: 'Deleted webhook org' },
    });
    createdOrgIds.push(foreignOrg.id);
    const deleted = await prisma.webhookSubscription.create({
      data: {
        orgId: foreignOrg.id,
        url: 'https://example.com/deleted',
        secret,
        events: ['document.created'],
        active: true,
        deletedAt: new Date(),
      },
    });
    createdSubscriptionIds.push(deleted.id);

    const res = await postDustWebhook({ metadata: { orgId } }, secret, eventType);
    expect(res.statusCode).toBe(200);

    const syncEvent = await prisma.syncEvent.findFirst({
      where: { eventType },
      orderBy: { receivedAt: 'desc' },
    });
    expect(syncEvent?.orgId).toBe(orgId);
  });

  skipIfNoDb('rejects signed webhooks whose payload org metadata does not match the subscription', async () => {
    const secret = `whsec_${randomUUID()}`;
    process.env.DUST_WEBHOOK_SECRET = secret;
    const eventType = `test.org-mismatch.${randomUUID()}`;
    eventTypes.push(eventType);

    const active = await prisma.webhookSubscription.create({
      data: {
        orgId: orgId!,
        url: 'https://example.com/webhook',
        secret,
        events: ['document.created'],
        active: true,
      },
    });
    createdSubscriptionIds.push(active.id);

    const res = await postDustWebhook(
      { metadata: { orgId: '00000000-0000-0000-0000-000000000001' } },
      secret,
      eventType,
    );
    expect(res.statusCode).toBe(403);

    const count = await prisma.syncEvent.count({ where: { eventType } });
    expect(count).toBe(0);
  });
});
