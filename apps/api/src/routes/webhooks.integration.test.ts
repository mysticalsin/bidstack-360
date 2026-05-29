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

async function postDustWebhook(
  payload: Record<string, unknown>,
  secret: string,
  eventType: string,
) {
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
      throw new Error(`[skip] ${name} - DATABASE_URL not reachable or seed org missing`);
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

  skipIfNoDb(
    'rejects signed webhooks whose payload org metadata does not match the subscription',
    async () => {
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
    },
  );

  skipIfNoDb(
    'rejects a validly-signed webhook whose timestamp is outside the 5-minute replay window',
    async () => {
      const secret = `whsec_${randomUUID()}`;
      process.env.DUST_WEBHOOK_SECRET = secret;
      const eventType = `test.stale-ts.${randomUUID()}`;
      // No eventTypes.push — a rejected request creates no syncEvent to clean up.

      const sub = await prisma.webhookSubscription.create({
        data: {
          orgId: orgId!,
          url: 'https://example.com/webhook',
          secret,
          events: ['document.created'],
          active: true,
        },
      });
      createdSubscriptionIds.push(sub.id);

      // 6 minutes in the past — just outside the MAX_TIMESTAMP_SKEW_MS (5 min).
      const staleTs = Date.now() - 6 * 60 * 1000;
      const body = JSON.stringify({ metadata: { orgId } });
      const res = await server.inject({
        method: 'POST',
        url: '/webhooks/dust',
        headers: {
          'content-type': 'application/json',
          'x-dust-signature': sign(body, secret),
          'x-dust-event': eventType,
          'x-dust-event-id': `evt_${randomUUID()}`,
          'x-dust-timestamp': String(staleTs),
        },
        payload: body,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toMatch(/replay window/i);

      // A replayed request must never reach the DB.
      const count = await prisma.syncEvent.count({ where: { eventType } });
      expect(count).toBe(0);
    },
  );

  skipIfNoDb(
    'deduplicates Dust retries — same x-dust-event-id must not create a second syncEvent',
    async () => {
      const secret = `whsec_${randomUUID()}`;
      process.env.DUST_WEBHOOK_SECRET = secret;
      const eventType = `test.dedup.${randomUUID()}`;
      eventTypes.push(eventType);

      const sub = await prisma.webhookSubscription.create({
        data: {
          orgId: orgId!,
          url: 'https://example.com/webhook',
          secret,
          events: ['document.created'],
          active: true,
        },
      });
      createdSubscriptionIds.push(sub.id);

      // Use a fixed event-id across both deliveries — simulates Dust retrying
      // a webhook that got no ack due to a transient network failure.
      const sharedEventId = `evt_${randomUUID()}`;
      const body = JSON.stringify({ metadata: { orgId } });

      // First delivery — must be accepted and persisted.
      const first = await server.inject({
        method: 'POST',
        url: '/webhooks/dust',
        headers: {
          'content-type': 'application/json',
          'x-dust-signature': sign(body, secret),
          'x-dust-event': eventType,
          'x-dust-event-id': sharedEventId,
          'x-dust-timestamp': String(Date.now()),
        },
        payload: body,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ ok: true });

      // Retry with the identical event-id — must ack (200) without writing a
      // second syncEvent. Works via Redis NX or the in-process fallback Map.
      const retry = await server.inject({
        method: 'POST',
        url: '/webhooks/dust',
        headers: {
          'content-type': 'application/json',
          'x-dust-signature': sign(body, secret),
          'x-dust-event': eventType,
          'x-dust-event-id': sharedEventId,
          'x-dust-timestamp': String(Date.now()),
        },
        payload: body,
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual({ ok: true });

      // Exactly one row — the duplicate was dropped before the DB write.
      const count = await prisma.syncEvent.count({ where: { eventType } });
      expect(count).toBe(1);
    },
  );
});
