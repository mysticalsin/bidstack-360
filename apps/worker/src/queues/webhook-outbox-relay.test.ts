import { describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({
  prisma: {},
  claimWebhookOutboxBatch: vi.fn(),
  markWebhookOutboxDispatched: vi.fn(),
  markWebhookOutboxFailed: vi.fn(),
}));

import {
  outboxDeliveryJobId,
  relayWebhookOutboxOnce,
  webhookOutboxRelayEnabled,
  webhookOutboxRelayMode,
  type OutboxDeliveryJob,
  type OutboxRelayDeps,
} from './webhook-outbox-relay.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const created = new Date('2026-11-06T12:00:00.000Z');

function row(id: string, attempts = 1) {
  return { id, orgId: ORG, event: 'lead.created', payload: { id }, attempts, createdAt: created };
}

function deps(overrides: Partial<OutboxRelayDeps> = {}) {
  const enqueued: OutboxDeliveryJob[][] = [];
  const base: OutboxRelayDeps = {
    claim: vi.fn(async () => [row('r1')]),
    subscriptionIds: vi.fn(async () => ['s1', 's2']),
    targetActive: vi.fn(async () => true),
    enqueue: vi.fn(async (jobs) => {
      enqueued.push(jobs);
    }),
    markDispatched: vi.fn(async () => {}),
    markFailed: vi.fn(async () => 'retry' as const),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
  return { d: base, enqueued };
}

describe('webhook outbox relay', () => {
  it('fans a row out to every subscription with deterministic job ids and a stable timestamp', async () => {
    const { d, enqueued } = deps();
    const result = await relayWebhookOutboxOnce(d);
    expect(result).toEqual({ claimed: 1, dispatched: 1, retried: 0, dead: 0 });
    const jobs = enqueued[0]!;
    expect(jobs.map((j) => j.opts.jobId)).toEqual([
      outboxDeliveryJobId('r1', 's1'),
      outboxDeliveryJobId('r1', 's2'),
    ]);
    expect(jobs.every((j) => !j.opts.jobId.includes(':'))).toBe(true);
    expect(jobs[0]!.data).toEqual({
      subscriptionId: 's1',
      event: 'lead.created',
      payload: { id: 'r1' },
      eventTimestamp: created.toISOString(),
    });
    expect(d.markDispatched).toHaveBeenCalledWith('r1');
  });

  it('re-relaying the same row produces the same job ids so the queue dedupes', async () => {
    const a = deps();
    const b = deps();
    await relayWebhookOutboxOnce(a.d);
    await relayWebhookOutboxOnce(b.d);
    expect(a.enqueued[0]!.map((j) => j.opts.jobId)).toEqual(b.enqueued[0]!.map((j) => j.opts.jobId));
  });

  it('marks a row dispatched without enqueueing when its subscriptions are gone', async () => {
    const { d, enqueued } = deps({ subscriptionIds: vi.fn(async () => []) });
    const result = await relayWebhookOutboxOnce(d);
    expect(enqueued).toHaveLength(0);
    expect(result.dispatched).toBe(1);
  });

  it('records a failed enqueue for retry and keeps relaying the rest of the batch', async () => {
    const enqueue = vi
      .fn<OutboxRelayDeps['enqueue']>()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(undefined);
    const { d } = deps({ claim: vi.fn(async () => [row('r1'), row('r2')]), enqueue });
    const result = await relayWebhookOutboxOnce(d);
    expect(result).toEqual({ claimed: 2, dispatched: 1, retried: 1, dead: 0 });
    expect(d.markFailed).toHaveBeenCalledWith('r1', 'redis down');
    expect(d.markDispatched).toHaveBeenCalledWith('r2');
    expect(d.markDispatched).not.toHaveBeenCalledWith('r1');
  });

  it('dead-letters a row once the store reports the attempt budget is spent', async () => {
    const { d } = deps({
      claim: vi.fn(async () => [row('r1', 8)]),
      enqueue: vi.fn(async () => {
        throw new Error('redis down');
      }),
      markFailed: vi.fn(async () => 'dead' as const),
    });
    const result = await relayWebhookOutboxOnce(d);
    expect(result).toEqual({ claimed: 1, dispatched: 0, retried: 0, dead: 1 });
    expect(d.log.error).toHaveBeenCalledOnce();
  });

  it('is off unless WEBHOOK_OUTBOX_ENABLED is exactly true', () => {
    expect(webhookOutboxRelayEnabled({})).toBe(false);
    expect(webhookOutboxRelayEnabled({ WEBHOOK_OUTBOX_ENABLED: '1' })).toBe(false);
    expect(webhookOutboxRelayEnabled({ WEBHOOK_OUTBOX_ENABLED: 'true' })).toBe(true);
  });

  it('relays only targeted replays while the domain outbox flag is off', () => {
    // WHY: replay must work on every tenant, but turning the relay on must not
    // start delivering domain rows the API never wrote with the flag off.
    expect(webhookOutboxRelayMode({})).toBe('replays');
    expect(webhookOutboxRelayMode({ WEBHOOK_OUTBOX_ENABLED: 'true' })).toBe('all');
  });

  it('sends a targeted replay row to its one subscription and links the original message', async () => {
    const subscriptionIds = vi.fn(async () => ['s1', 's2']);
    const { d, enqueued } = deps({
      subscriptionIds,
      claim: vi.fn(async () => [
        { ...row('r9'), subscriptionId: 's2', replayOfId: 'm-original' },
      ]),
    });
    await relayWebhookOutboxOnce(d);
    expect(subscriptionIds).not.toHaveBeenCalled();
    expect(enqueued[0]).toHaveLength(1);
    expect(enqueued[0]![0]!.opts.jobId).toBe(outboxDeliveryJobId('r9', 's2'));
    expect(enqueued[0]![0]!.data).toMatchObject({ subscriptionId: 's2', replayOfId: 'm-original' });
  });

  it('drops a targeted replay whose subscription is gone or paused', async () => {
    const { d, enqueued } = deps({
      targetActive: vi.fn(async () => false),
      claim: vi.fn(async () => [{ ...row('r9'), subscriptionId: 's2', replayOfId: 'm-original' }]),
    });
    const result = await relayWebhookOutboxOnce(d);
    expect(enqueued).toHaveLength(0);
    expect(result.dispatched).toBe(1);
  });
});
