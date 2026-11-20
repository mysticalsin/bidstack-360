import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addBulk = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class {
    addBulk = addBulk;
  },
}));

vi.mock('ioredis', () => ({
  default: class {
    on() {
      return this;
    }
  },
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    webhookSubscription: {
      findMany: vi.fn(),
    },
  },
  recordWebhookOutboxEvent: vi.fn(),
}));

import { prisma, recordWebhookOutboxEvent } from '@bidstack/db';
import { fanOutWebhookEvent, webhookDeliveryJobId } from './webhook-delivery.js';

const findMany = vi.mocked(prisma.webhookSubscription.findMany);
const recordOutbox = vi.mocked(recordWebhookOutboxEvent);

describe('webhook delivery identity', () => {
  beforeEach(() => {
    addBulk.mockReset();
    findMany.mockReset();
  });

  it('builds a stable job id without a colon so retries dedupe', () => {
    // WHY: Date.now() made every proposal.submitted enqueue a new job, so a
    // retry delivered the same approval event twice.
    const eventKey = '11111111-1111-4111-8111-111111111111:submitted:v2';
    const first = webhookDeliveryJobId('proposal.submitted', 'sub-1', eventKey);
    const second = webhookDeliveryJobId('proposal.submitted', 'sub-1', eventKey);
    expect(first).toBe(second);
    expect(first).not.toContain(':');
  });

  it('reports outcome_unknown when enqueue fails and does not claim delivery', async () => {
    findMany.mockResolvedValue([{ id: 'sub-1' }] as never);
    addBulk.mockRejectedValue(new Error('redis down'));
    const result = await fanOutWebhookEvent('org', 'proposal.submitted', { id: 'p' }, {
      idempotencyKey: 'p:submitted:v1',
    });
    expect(result).toEqual({ delivery: 'outcome_unknown' });
  });

  it('uses the idempotency key in the queued job id', async () => {
    findMany.mockResolvedValue([{ id: 'sub-1' }] as never);
    addBulk.mockResolvedValue([]);
    const result = await fanOutWebhookEvent('org', 'proposal.submitted', { id: 'p' }, {
      idempotencyKey: 'p:submitted:v1',
    });
    expect(result).toEqual({ delivery: 'enqueued', count: 1 });
    const jobs = addBulk.mock.calls[0]?.[0] as Array<{ opts: { jobId: string } }>;
    expect(jobs[0]?.opts.jobId).toBe(webhookDeliveryJobId('proposal.submitted', 'sub-1', 'p:submitted:v1'));
  });

  describe('with WEBHOOK_OUTBOX_ENABLED=true', () => {
    beforeEach(() => {
      vi.stubEnv('WEBHOOK_OUTBOX_ENABLED', 'true');
      recordOutbox.mockReset();
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('records the event in the outbox with its idempotency key instead of enqueueing', async () => {
      findMany.mockResolvedValue([{ id: 'sub-1' }, { id: 'sub-2' }] as never);
      recordOutbox.mockResolvedValue({ id: 'ob-1', duplicate: false });
      const result = await fanOutWebhookEvent('org', 'proposal.submitted', { id: 'p' }, {
        idempotencyKey: 'p:submitted:v1',
      });
      expect(result).toEqual({ delivery: 'enqueued', count: 2 });
      expect(addBulk).not.toHaveBeenCalled();
      expect(recordOutbox).toHaveBeenCalledWith(expect.anything(), {
        orgId: 'org',
        event: 'proposal.submitted',
        payload: { id: 'p' },
        idempotencyKey: 'p:submitted:v1',
      });
    });

    it('writes through the caller transaction when one is passed', async () => {
      findMany.mockResolvedValue([{ id: 'sub-1' }] as never);
      recordOutbox.mockResolvedValue({ id: 'ob-1', duplicate: true });
      const tx = { marker: 'tx' } as never;
      await fanOutWebhookEvent('org', 'lead.created', { id: 'l' }, { tx });
      expect(recordOutbox.mock.calls[0]?.[0]).toBe(tx);
    });

    it('reports outcome_unknown when the outbox write fails', async () => {
      findMany.mockResolvedValue([{ id: 'sub-1' }] as never);
      recordOutbox.mockRejectedValue(new Error('db down'));
      const result = await fanOutWebhookEvent('org', 'lead.created', { id: 'l' });
      expect(result).toEqual({ delivery: 'outcome_unknown' });
    });

    it('records nothing when no subscription listens to the event', async () => {
      findMany.mockResolvedValue([] as never);
      const result = await fanOutWebhookEvent('org', 'lead.created', { id: 'l' });
      expect(result).toEqual({ delivery: 'no_subscribers' });
      expect(recordOutbox).not.toHaveBeenCalled();
    });
  });
});
