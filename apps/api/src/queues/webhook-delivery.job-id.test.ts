import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}));

import { prisma } from '@bidstack/db';
import { fanOutWebhookEvent, webhookDeliveryJobId } from './webhook-delivery.js';

const findMany = vi.mocked(prisma.webhookSubscription.findMany);

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
});
