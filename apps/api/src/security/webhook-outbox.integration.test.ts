/**
 * Webhook outbox store against real Postgres.
 *
 * Idempotency keys dedupe per org, concurrent relays never claim the same row
 * (SKIP LOCKED), each claim pushes the next attempt out by exponential backoff,
 * and a row that exhausts its attempts is dead-lettered and never claimed again.
 */
import { randomUUID } from 'node:crypto';

import {
  WEBHOOK_OUTBOX_MAX_ATTEMPTS,
  claimWebhookOutboxBatch,
  markWebhookOutboxDispatched,
  markWebhookOutboxFailed,
  prisma,
  recordWebhookOutboxEvent,
  webhookOutboxBackoffMs,
} from '@bidstack/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let orgId = '';
let otherOrgId = '';

async function makeOrg(label: string) {
  return (await prisma.org.create({ data: { clerkOrg: `org_outbox_${label}_${randomUUID()}`, name: `Outbox ${label}` } })).id;
}

async function makeDue(id: string) {
  await prisma.$executeRaw`UPDATE webhook_outbox SET next_attempt_at = now() - interval '1 second' WHERE id = ${id}::uuid`;
}

beforeAll(async () => {
  orgId = await makeOrg('a');
  otherOrgId = await makeOrg('b');
});

beforeEach(async () => {
  // Nothing else writes the outbox with WEBHOOK_OUTBOX_ENABLED unset; clear
  // leftovers so claims only see this test's rows.
  await prisma.$executeRaw`DELETE FROM webhook_outbox`;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM webhook_outbox WHERE org_id IN (${orgId}::uuid, ${otherOrgId}::uuid)`;
  await prisma.org.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
});

describe('webhook outbox store', () => {
  it('records an idempotency key once per org', async () => {
    const first = await recordWebhookOutboxEvent(prisma, {
      orgId,
      event: 'lead.created',
      payload: { id: 'l1' },
      idempotencyKey: 'lead:l1:created',
    });
    const replay = await recordWebhookOutboxEvent(prisma, {
      orgId,
      event: 'lead.created',
      payload: { id: 'l1', changed: true },
      idempotencyKey: 'lead:l1:created',
    });
    const otherTenant = await recordWebhookOutboxEvent(prisma, {
      orgId: otherOrgId,
      event: 'lead.created',
      payload: { id: 'l1' },
      idempotencyKey: 'lead:l1:created',
    });
    expect(first.duplicate).toBe(false);
    expect(replay).toEqual({ id: first.id, duplicate: true });
    expect(otherTenant.duplicate).toBe(false);
    const rows = await prisma.webhookOutbox.findMany({ where: { orgId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ id: 'l1' });
  });

  it('rolls back with the caller transaction', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await recordWebhookOutboxEvent(tx, {
          orgId,
          event: 'lead.created',
          payload: {},
          idempotencyKey: 'rolled-back',
        });
        throw new Error('domain write failed');
      }),
    ).rejects.toThrow('domain write failed');
    expect(await prisma.webhookOutbox.count({ where: { orgId } })).toBe(0);
  });

  it('never hands the same row to two concurrent claimers', async () => {
    for (let i = 0; i < 30; i += 1) {
      await recordWebhookOutboxEvent(prisma, {
        orgId,
        event: 'lead.created',
        payload: { i },
        idempotencyKey: `k${i}`,
      });
    }
    const batches = await Promise.all(
      Array.from({ length: 5 }, () => claimWebhookOutboxBatch(prisma, 10)),
    );
    const ids = batches.flat().map((r) => r.id);
    expect(ids.length).toBe(30);
    expect(new Set(ids).size).toBe(30);
  });

  it('pushes the next attempt out by exponential backoff and only returns due rows', async () => {
    const { id } = await recordWebhookOutboxEvent(prisma, {
      orgId,
      event: 'lead.created',
      payload: {},
      idempotencyKey: 'backoff',
    });
    const gaps: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = await claimWebhookOutboxBatch(prisma, 10);
      expect(claimed.map((r) => [r.id, r.attempts])).toEqual([[id, attempt]]);
      expect(await claimWebhookOutboxBatch(prisma, 10)).toEqual([]);
      const [row] = await prisma.$queryRaw<Array<{ gap_ms: number }>>`
        SELECT (extract(epoch FROM next_attempt_at - now()) * 1000)::float8 AS gap_ms
          FROM webhook_outbox WHERE id = ${id}::uuid`;
      gaps.push(row!.gap_ms);
      await markWebhookOutboxFailed(prisma, id, 'redis down');
      await makeDue(id);
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(gaps[attempt - 1]).toBeGreaterThan(webhookOutboxBackoffMs(attempt) - 2_000);
      expect(gaps[attempt - 1]).toBeLessThanOrEqual(webhookOutboxBackoffMs(attempt));
    }
    expect(webhookOutboxBackoffMs(30)).toBe(15 * 60_000);
  });

  it('dead-letters a row after the attempt budget and never claims it again', async () => {
    const { id } = await recordWebhookOutboxEvent(prisma, {
      orgId,
      event: 'lead.created',
      payload: {},
      idempotencyKey: 'dead',
    });
    const outcomes: string[] = [];
    for (let attempt = 1; attempt <= WEBHOOK_OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      expect(await claimWebhookOutboxBatch(prisma, 10)).toHaveLength(1);
      outcomes.push(await markWebhookOutboxFailed(prisma, id, `fail ${attempt}`));
      await makeDue(id);
    }
    expect(outcomes.slice(0, -1).every((o) => o === 'retry')).toBe(true);
    expect(outcomes.at(-1)).toBe('dead');
    expect(await claimWebhookOutboxBatch(prisma, 10)).toEqual([]);
    const row = await prisma.webhookOutbox.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('dead');
    expect(row.lastError).toBe(`fail ${WEBHOOK_OUTBOX_MAX_ATTEMPTS}`);
  });

  it('does not claim a dispatched row again', async () => {
    const { id } = await recordWebhookOutboxEvent(prisma, {
      orgId,
      event: 'lead.created',
      payload: {},
      idempotencyKey: 'done',
    });
    await claimWebhookOutboxBatch(prisma, 10);
    await markWebhookOutboxDispatched(prisma, id);
    await makeDue(id);
    expect(await claimWebhookOutboxBatch(prisma, 10)).toEqual([]);
    const row = await prisma.webhookOutbox.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('dispatched');
    expect(row.dispatchedAt).not.toBeNull();
  });
});
