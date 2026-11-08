/**
 * Webhook message log, attempt detail, replay, delivery stats, retry policy and
 * secret rotation (factory slice 4).
 *
 * Seeds messages and attempts straight into the DB for an isolated org and a
 * foreign org, then drives the routes as the org Admin (and as a Sales Manager
 * through the stub role header for the permission checks).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import {
  _resetIntegrationTokenKey,
  decryptSecret,
  encryptSecret,
  hashWebhookSigningSecret,
} from '@bidstack/shared/server-crypto';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const TEST_TOKEN_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const MANAGER = { 'x-bidstack-e2e-role': 'manager' };

let server: Awaited<ReturnType<typeof buildServer>>;
let orgId = '';
let foreignOrgId = '';
let restoreAuth: (() => void) | null = null;
let previousTokenKey: string | undefined;
let previousRoleHeader: string | undefined;
let subA = '';
let subB = '';
let foreignSub = '';
let foreignMessage = '';
const messages: string[] = [];

async function seedSubscription(org: string, url: string): Promise<string> {
  const secret = `whsec_${randomUUID()}`;
  const sub = await prisma.webhookSubscription.create({
    data: {
      orgId: org,
      url,
      secret: encryptSecret(secret),
      secretHash: hashWebhookSigningSecret(secret),
      events: ['lead.created', 'opportunity.created'],
    },
  });
  return sub.id;
}

async function seedMessage(args: {
  org: string;
  sub: string;
  event: string;
  status: 'pending' | 'succeeded' | 'failed';
  createdAt: Date;
  attempts: Array<{ statusCode: number | null; durationMs: number; body?: string }>;
}): Promise<string> {
  const id = randomUUID();
  const last = args.attempts.at(-1)!;
  await prisma.webhookMessage.create({
    data: {
      id,
      orgId: args.org,
      subscriptionId: args.sub,
      event: args.event,
      payload: { leadId: 'lead-1', password: 'hunter2' },
      eventTimestamp: args.createdAt,
      status: args.status,
      attempts: args.attempts.length,
      lastStatusCode: last.statusCode,
      lastDurationMs: last.durationMs,
      createdAt: args.createdAt,
    },
  });
  let n = 0;
  for (const a of args.attempts) {
    n += 1;
    await prisma.webhookDelivery.create({
      data: {
        orgId: args.org,
        subscriptionId: args.sub,
        messageId: id,
        event: args.event,
        statusCode: a.statusCode,
        success: a.statusCode !== null && a.statusCode < 300,
        durationMs: a.durationMs,
        attempt: n,
        requestHeaders: { 'X-Polo-Signature': 't=1700000000,v1=****', 'Content-Type': 'application/json' },
        responseBody: a.body ?? null,
        createdAt: new Date(args.createdAt.getTime() + n * 1000),
      },
    });
  }
  return id;
}

beforeAll(async () => {
  previousTokenKey = process.env.INTEGRATION_TOKEN_KEY;
  previousRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.INTEGRATION_TOKEN_KEY = TEST_TOKEN_KEY;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  _resetIntegrationTokenKey();
  await prisma.$queryRaw`SELECT 1`;

  const org = await createIsolatedOrg('webhook-messages');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  foreignOrgId = (
    await prisma.org.create({ data: { clerkOrg: `org_whmsg_${randomUUID()}`, name: 'Webhook Foreign Org' } })
  ).id;

  subA = await seedSubscription(orgId, 'https://a.example.com/hook');
  subB = await seedSubscription(orgId, 'https://b.example.com/hook');
  foreignSub = await seedSubscription(foreignOrgId, 'https://foreign.example.com/hook');

  const now = Date.now();
  for (let i = 0; i < 7; i += 1) {
    messages.push(
      await seedMessage({
        org: orgId,
        sub: i % 2 === 0 ? subA : subB,
        event: i % 3 === 0 ? 'opportunity.created' : 'lead.created',
        status: i === 1 ? 'failed' : 'succeeded',
        createdAt: new Date(now - (i + 1) * 60_000),
        attempts:
          i === 1
            ? [
                { statusCode: 500, durationMs: 900, body: '{"error":"boom","token":"leak-me"}' },
                { statusCode: 503, durationMs: 1200 },
              ]
            : [{ statusCode: 200, durationMs: 100 + i * 10, body: '{"ok":true}' }],
      }),
    );
  }
  foreignMessage = await seedMessage({
    org: foreignOrgId,
    sub: foreignSub,
    event: 'lead.created',
    status: 'failed',
    createdAt: new Date(now - 30_000),
    attempts: [{ statusCode: 500, durationMs: 50, body: 'FOREIGN-BODY' }],
  });

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (foreignOrgId) await prisma.org.deleteMany({ where: { id: foreignOrgId } });
  if (orgId) await dropIsolatedOrg(orgId);
  if (previousTokenKey === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
  else process.env.INTEGRATION_TOKEN_KEY = previousTokenKey;
  if (previousRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousRoleHeader;
  _resetIntegrationTokenKey();
});

type ListBody = {
  items: Array<{ id: string; subscriptionId: string; url: string; event: string; status: string; attempts: number }>;
  nextCursor: string | null;
};

describe('GET /webhook-messages', () => {
  it('pages newest first with a cursor and never repeats or skips a row', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/webhook-messages?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as ListBody;
      seen.push(...body.items.map((m) => m.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(messages);
  });

  it('never skips rows that share a millisecond at a page boundary', async () => {
    const subC = await seedSubscription(orgId, 'https://c.example.com/hook');
    const base = new Date(Date.now() - 3600_000);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push(await seedMessage({ org: orgId, sub: subC, event: 'lead.created', status: 'succeeded', createdAt: base, attempts: [{ statusCode: 200, durationMs: 10 }] }));
    }
    // Same millisecond, distinct microseconds, newest first: ids[0] is the newest.
    for (let i = 0; i < ids.length; i += 1) {
      await prisma.$executeRaw`UPDATE webhook_messages SET created_at = ${base}::timestamptz + make_interval(secs => ${(900 - i * 100) / 1_000_000}) WHERE id = ${ids[i]}::uuid`;
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page += 1) {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/webhook-messages?subscriptionId=${subC}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as ListBody;
      seen.push(...body.items.map((m) => m.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    await prisma.webhookDelivery.deleteMany({ where: { subscriptionId: subC } });
    await prisma.webhookMessage.deleteMany({ where: { subscriptionId: subC } });
    await prisma.webhookSubscription.deleteMany({ where: { id: subC } });
    expect(seen).toEqual(ids);
  });

  it('filters by endpoint, event, status and time', async () => {
    const byEndpoint = (await server.inject({ method: 'GET', url: `/api/v1/webhook-messages?subscriptionId=${subB}` })).json() as ListBody;
    expect(byEndpoint.items.every((m) => m.subscriptionId === subB && m.url === 'https://b.example.com/hook')).toBe(true);
    expect(byEndpoint.items).toHaveLength(3);

    const failed = (await server.inject({ method: 'GET', url: '/api/v1/webhook-messages?status=failed' })).json() as ListBody;
    expect(failed.items.map((m) => m.id)).toEqual([messages[1]]);
    expect(failed.items[0]!.attempts).toBe(2);

    const opp = (await server.inject({ method: 'GET', url: '/api/v1/webhook-messages?event=opportunity.created' })).json() as ListBody;
    expect(opp.items.map((m) => m.id)).toEqual([messages[0], messages[3], messages[6]]);

    const from = new Date(Date.now() - 2.5 * 60_000).toISOString();
    const recent = (await server.inject({ method: 'GET', url: `/api/v1/webhook-messages?from=${from}` })).json() as ListBody;
    expect(recent.items.map((m) => m.id)).toEqual([messages[0], messages[1]]);
  });

  it('rejects a malformed cursor and an unknown status', async () => {
    expect((await server.inject({ method: 'GET', url: '/api/v1/webhook-messages?cursor=not-a-cursor' })).statusCode).toBe(400);
    expect((await server.inject({ method: 'GET', url: '/api/v1/webhook-messages?status=lost' })).statusCode).toBe(400);
  });

  it('never lists another tenant’s messages', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/webhook-messages?limit=100' });
    expect(res.body).not.toContain(foreignMessage);
    expect(res.body).not.toContain(foreignSub);
    const probe = await server.inject({ method: 'GET', url: `/api/v1/webhook-messages?subscriptionId=${foreignSub}` });
    expect((probe.json() as ListBody).items).toEqual([]);
  });
});

describe('GET /webhook-messages/:id', () => {
  it('returns every attempt with response code, redacted capped body and masked signature', async () => {
    const res = await server.inject({ method: 'GET', url: `/api/v1/webhook-messages/${messages[1]}` });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      message: { id: string; url: string; status: string };
      requestBody: string;
      attempts: Array<{ attempt: number; statusCode: number | null; responseBody: string | null; requestHeaders: Record<string, string> }>;
    };
    expect(body.message).toMatchObject({ id: messages[1], url: 'https://b.example.com/hook', status: 'failed' });
    expect(body.attempts.map((a) => [a.attempt, a.statusCode])).toEqual([
      [1, 500],
      [2, 503],
    ]);
    expect(body.attempts[0]!.requestHeaders['X-Polo-Signature']).toBe('t=1700000000,v1=****');
    expect(res.body).not.toContain('leak-me');
    expect(res.body).not.toContain('hunter2');
    expect(JSON.parse(body.requestBody)).toMatchObject({ id: messages[1], event: 'lead.created' });
  });

  it('answers 404 for a foreign message', async () => {
    const res = await server.inject({ method: 'GET', url: `/api/v1/webhook-messages/${foreignMessage}` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('FOREIGN-BODY');
  });
});

describe('POST /webhook-messages/:id/replay', () => {
  it('re-enqueues through the outbox for that one endpoint, once per request id, and audits it', async () => {
    const requestId = randomUUID();
    const first = await server.inject({
      method: 'POST',
      url: `/api/v1/webhook-messages/${messages[1]}/replay`,
      payload: { requestId },
    });
    expect(first.statusCode, first.body).toBe(202);
    const a = first.json() as { outboxId: string; duplicate: boolean };
    expect(a.duplicate).toBe(false);

    const again = await server.inject({
      method: 'POST',
      url: `/api/v1/webhook-messages/${messages[1]}/replay`,
      payload: { requestId },
    });
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual({ outboxId: a.outboxId, duplicate: true });

    const rows = await prisma.$queryRaw<Array<{ subscription_id: string; replay_of_id: string; event: string }>>`
      SELECT subscription_id::text, replay_of_id::text, event FROM webhook_outbox WHERE id = ${a.outboxId}::uuid`;
    expect(rows).toEqual([{ subscription_id: subB, replay_of_id: messages[1], event: 'lead.created' }]);

    const audits = await prisma.auditLog.findMany({
      where: { orgId, action: 'webhook_message.replay', targetId: messages[1] },
      take: 5,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.rowHash).toMatch(/^[0-9a-f]{64}$/);
    expect(audits[0]!.diff).toMatchObject({ outboxId: a.outboxId, subscriptionId: subB });
  });

  it('is denied to a role without webhooks:replay', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/webhook-messages/${messages[1]}/replay`,
      headers: MANAGER,
      payload: { requestId: randomUUID() },
    });
    expect(res.statusCode).toBe(403);
    const list = await server.inject({ method: 'GET', url: '/api/v1/webhook-messages', headers: MANAGER });
    expect(list.statusCode).toBe(200);
  });

  it('refuses to replay to a paused endpoint', async () => {
    await prisma.webhookSubscription.update({ where: { id: subB }, data: { active: false } });
    try {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/webhook-messages/${messages[1]}/replay`,
        payload: { requestId: randomUUID() },
      });
      expect(res.statusCode, res.body).toBe(409);
    } finally {
      await prisma.webhookSubscription.update({ where: { id: subB }, data: { active: true } });
    }
  });

  it('cannot replay a foreign message and rejects a body without a request id', async () => {
    const foreign = await server.inject({
      method: 'POST',
      url: `/api/v1/webhook-messages/${foreignMessage}/replay`,
      payload: { requestId: randomUUID() },
    });
    expect(foreign.statusCode).toBe(404);
    const bad = await server.inject({ method: 'POST', url: `/api/v1/webhook-messages/${messages[1]}/replay`, payload: {} });
    expect(bad.statusCode).toBe(400);
  });
});

describe('GET /webhook-deliveries/stats', () => {
  it('reports success rate, an endpoint by hour heatmap and latency samples', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/webhook-deliveries/stats?window=24h' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      messages: { total: number; succeeded: number; failed: number; pending: number };
      successRate: number;
      heatmap: Array<{ subscriptionId: string; hour: number; attempts: number; failures: number }>;
      latencyMs: number[];
    };
    expect(body.messages).toMatchObject({ total: 7, succeeded: 6, failed: 1 });
    expect(body.successRate).toBeCloseTo(6 / 7, 5);
    const attempts = body.heatmap.reduce((n, c) => n + c.attempts, 0);
    const failures = body.heatmap.reduce((n, c) => n + c.failures, 0);
    expect(attempts).toBe(8);
    expect(failures).toBe(2);
    expect(body.heatmap.every((c) => c.hour >= 0 && c.hour <= 23)).toBe(true);
    expect(body.heatmap.some((c) => c.subscriptionId === foreignSub)).toBe(false);
    expect(body.latencyMs).toHaveLength(8);

    const one = (await server.inject({ method: 'GET', url: `/api/v1/webhook-deliveries/stats?subscriptionId=${subA}` })).json() as typeof body;
    expect(one.messages.total).toBe(4);
  });
});

describe('retry policy per endpoint', () => {
  it('reads the default, saves a valid policy with an audit row, and resets it', async () => {
    const url = `/api/v1/webhook-subscriptions/${subA}/retry-policy`;
    const initial = await server.inject({ method: 'GET', url });
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json()).toEqual({ maxAttempts: 5, backoffStrategy: 'exponential', backoffBaseSeconds: 30, timeoutMs: 10_000 });

    const saved = await server.inject({
      method: 'PUT',
      url,
      payload: { maxAttempts: 3, backoffStrategy: 'linear', backoffBaseSeconds: 60, timeoutMs: 5000 },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await server.inject({ method: 'GET', url })).json()).toMatchObject({ maxAttempts: 3, backoffStrategy: 'linear' });
    const audit = await prisma.auditLog.findFirst({
      where: { orgId, action: 'webhook_subscription.retry_policy', targetId: subA },
    });
    expect(audit?.diff).toMatchObject({ maxAttempts: 3, backoffStrategy: 'linear', backoffBaseSeconds: 60, timeoutMs: 5000 });

    const reset = await server.inject({ method: 'DELETE', url });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ maxAttempts: 5, backoffStrategy: 'exponential' });
  });

  it('rejects out-of-range values, foreign endpoints and non-writers', async () => {
    const url = `/api/v1/webhook-subscriptions/${subA}/retry-policy`;
    const policy = { maxAttempts: 3, backoffStrategy: 'linear', backoffBaseSeconds: 60, timeoutMs: 5000 };
    expect((await server.inject({ method: 'PUT', url, payload: { ...policy, maxAttempts: 50 } })).statusCode).toBe(400);
    expect(
      (await server.inject({ method: 'PUT', url: `/api/v1/webhook-subscriptions/${foreignSub}/retry-policy`, payload: policy }))
        .statusCode,
    ).toBe(404);
    expect((await server.inject({ method: 'GET', url: `/api/v1/webhook-subscriptions/${foreignSub}/retry-policy` })).statusCode).toBe(404);
    expect((await server.inject({ method: 'PUT', url, headers: MANAGER, payload: policy })).statusCode).toBe(403);
  });
});

describe('POST /webhook-subscriptions/:id/rotate-secret', () => {
  it('returns the new secret once, keeps the old one for the overlap window, and audits without the secret', async () => {
    const before = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: subB } });
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/webhook-subscriptions/${subB}/rotate-secret`,
      payload: { overlapHours: 24 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { signingSecret, previousSecretExpiresAt } = res.json() as { signingSecret: string; previousSecretExpiresAt: string };
    expect(signingSecret).toMatch(/^whsec_/);
    const after = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: subB } });
    expect(decryptSecret(after.secret)).toBe(signingSecret);
    expect(after.previousSecret).toBe(before.secret);
    expect(after.previousSecretExpiresAt?.toISOString()).toBe(previousSecretExpiresAt);

    const list = await server.inject({ method: 'GET', url: '/api/v1/webhook-subscriptions' });
    expect(list.body).not.toContain(signingSecret);
    const audit = await prisma.auditLog.findFirst({
      where: { orgId, action: 'webhook_subscription.rotate_secret', targetId: subB },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.diff)).not.toContain(signingSecret);
  });

  it('refuses a second rotation while the overlap window is open', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/webhook-subscriptions/${subB}/rotate-secret`,
      payload: { overlapHours: 24 },
    });
    expect(res.statusCode, res.body).toBe(409);
  });

  it('cannot rotate a foreign endpoint', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/webhook-subscriptions/${foreignSub}/rotate-secret`,
      payload: { overlapHours: 0 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('endpoint timeout on the subscription', () => {
  it('PATCH accepts a timeout within bounds and returns it', async () => {
    const ok = await server.inject({ method: 'PATCH', url: `/api/v1/webhook-subscriptions/${subA}`, payload: { timeoutMs: 7000 } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ timeoutMs: 7000 });
    const bad = await server.inject({ method: 'PATCH', url: `/api/v1/webhook-subscriptions/${subA}`, payload: { timeoutMs: 120_000 } });
    expect(bad.statusCode).toBe(400);
  });
});
