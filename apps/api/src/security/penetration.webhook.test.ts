// Integration tests — webhook HMAC bypass
//
// Key invariants verified:
//   - Forged signature (wrong secret) → 401, no syncEvent row persisted
//   - Valid HMAC inside 5-min replay window → 200
//   - Valid HMAC outside 5-min replay window → 401, no syncEvent row persisted
//   - Missing x-dust-event-id header → 400

import { randomUUID } from 'node:crypto';
import { describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { makePentestContext, sign } from './penetration.test-helpers.js';

const { ctx, skipIfNoDb } = makePentestContext();

describe('penetration: webhook HMAC bypass', () => {
  skipIfNoDb('forged signature is rejected with 401', async () => {
    const secret = `whsec_${randomUUID()}`;
    process.env.DUST_WEBHOOK_SECRET = secret;
    const eventType = `pentest.forged-sig.${randomUUID()}`;
    ctx.cleanup.syncEventTypes.push(eventType);

    const body = JSON.stringify({ metadata: { orgId: ctx.seedOrgId } });
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/webhooks/dust',
      headers: {
        'content-type': 'application/json',
        // signed with the WRONG secret — must not validate
        'x-dust-signature': sign(body, 'attacker-secret'),
        'x-dust-event': eventType,
        'x-dust-event-id': `evt_${randomUUID()}`,
        'x-dust-timestamp': String(Date.now()),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);

    // WHY: a rejected event must not be persisted — otherwise a replay could
    // trigger processing after a signature upgrade patches the validation logic.
    const persisted = await prisma.syncEvent.count({ where: { eventType } });
    expect(persisted).toBe(0);
  });

  skipIfNoDb('valid signature inside 5min replay window is accepted (200)', async () => {
    const secret = `whsec_${randomUUID()}`;
    process.env.DUST_WEBHOOK_SECRET = secret;
    const eventType = `pentest.in-window.${randomUUID()}`;
    ctx.cleanup.syncEventTypes.push(eventType);

    const sub = await prisma.webhookSubscription.create({
      data: {
        orgId: ctx.seedOrgId!,
        url: 'https://example.com/pentest',
        secret,
        events: ['document.created'],
        active: true,
      },
    });
    ctx.cleanup.subscriptionIds.push(sub.id);

    const body = JSON.stringify({ metadata: { orgId: ctx.seedOrgId } });
    const res = await ctx.server.inject({
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
    expect(res.statusCode).toBe(200);
  });

  skipIfNoDb('replay outside 5min window is rejected with 401', async () => {
    const secret = `whsec_${randomUUID()}`;
    process.env.DUST_WEBHOOK_SECRET = secret;
    const eventType = `pentest.replay.${randomUUID()}`;
    ctx.cleanup.syncEventTypes.push(eventType);

    const sub = await prisma.webhookSubscription.create({
      data: {
        orgId: ctx.seedOrgId!,
        url: 'https://example.com/pentest',
        secret,
        events: ['document.created'],
        active: true,
      },
    });
    ctx.cleanup.subscriptionIds.push(sub.id);

    const body = JSON.stringify({ metadata: { orgId: ctx.seedOrgId } });
    const oldTimestamp = String(Date.now() - 10 * 60 * 1000); // 10 min ago
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/webhooks/dust',
      headers: {
        'content-type': 'application/json',
        'x-dust-signature': sign(body, secret),
        'x-dust-event': eventType,
        'x-dust-event-id': `evt_${randomUUID()}`,
        'x-dust-timestamp': oldTimestamp,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);

    const persisted = await prisma.syncEvent.count({ where: { eventType } });
    expect(persisted).toBe(0);
  });

  skipIfNoDb('missing event-id header is rejected with 400', async () => {
    const secret = `whsec_${randomUUID()}`;
    process.env.DUST_WEBHOOK_SECRET = secret;
    const body = JSON.stringify({ metadata: { orgId: ctx.seedOrgId } });
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/webhooks/dust',
      headers: {
        'content-type': 'application/json',
        'x-dust-signature': sign(body, secret),
        'x-dust-event': 'pentest.no-eid',
        'x-dust-timestamp': String(Date.now()),
        // x-dust-event-id intentionally absent
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });
});
