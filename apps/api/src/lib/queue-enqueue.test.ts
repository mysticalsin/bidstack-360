import { EventEmitter } from 'node:events';

import sensible from '@fastify/sensible';
import type { Queue } from 'bullmq';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { errorHandlerPlugin } from '../plugins/error-handler.js';

import { addWithinDeadline, isQueueUnavailableError, QueueUnavailableError } from './queue-enqueue.js';

// WHY: request handlers await these enqueues after committing their own rows.
// An unbounded wait turned a Redis outage into a hung request and a duplicate
// write on client retry; the deadline must hold before and after 'ready'.
class FakeClient extends EventEmitter {
  constructor(public status: string) {
    super();
  }
}

function fakeQueue(client: FakeClient | Promise<FakeClient>): Queue {
  return { name: 'test-queue', client: Promise.resolve(client) } as unknown as Queue;
}

const never = () => new Promise<never>(() => {});

describe('addWithinDeadline', () => {
  it('returns the add result when Redis answers', async () => {
    const add = vi.fn(async () => ({ id: 'job-1' }));
    await expect(addWithinDeadline(fakeQueue(new FakeClient('ready')), add, 50)).resolves.toEqual({ id: 'job-1' });
    expect(add).toHaveBeenCalledOnce();
  });

  it('never sends the add while Redis is not ready, so nothing lands on reconnect', async () => {
    const client = new FakeClient('reconnecting');
    const add = vi.fn(async () => ({ id: 'job-1' }));

    const err = await addWithinDeadline(fakeQueue(client), add, 30).catch((e: unknown) => e);

    expect(isQueueUnavailableError(err)).toBe(true);
    expect((err as QueueUnavailableError).reason).toBe('not-ready');
    expect(add).not.toHaveBeenCalled();
    expect(client.listenerCount('ready')).toBe(0);
  });

  it('bounds the wait for the BullMQ client itself', async () => {
    const queue = { name: 'test-queue', client: never() } as unknown as Queue;
    const err = await addWithinDeadline(queue, vi.fn(), 30).catch((e: unknown) => e);
    expect((err as QueueUnavailableError).reason).toBe('not-ready');
  });

  it('sends the add once Redis becomes ready inside the deadline', async () => {
    const client = new FakeClient('connecting');
    const add = vi.fn(async () => 'ok');
    setTimeout(() => {
      client.status = 'ready';
      client.emit('ready');
    }, 10);

    await expect(addWithinDeadline(fakeQueue(client), add, 500)).resolves.toBe('ok');
    expect(client.listenerCount('ready')).toBe(0);
  });

  it('gives up when a ready Redis never answers the add', async () => {
    const started = Date.now();
    const err = await addWithinDeadline(fakeQueue(new FakeClient('ready')), never, 40).catch((e: unknown) => e);

    expect((err as QueueUnavailableError).reason).toBe('timed-out');
    expect((err as QueueUnavailableError).statusCode).toBe(503);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('passes Redis errors through unchanged for the caller to handle', async () => {
    const boom = new Error('READONLY');
    const err = await addWithinDeadline(fakeQueue(new FakeClient('ready')), async () => Promise.reject(boom), 50).catch(
      (e: unknown) => e,
    );
    expect(err).toBe(boom);
  });
});

describe('queue unavailable through the production error handler', () => {
  // Routes that cannot fail open (call re-analysis, provider webhooks,
  // migrations) let this error propagate. Clients and webhook senders must get
  // a retryable 503, not the generic masked 500 or a request that never ends.
  it('answers 503 Service Unavailable when the add never completes', async () => {
    const app = Fastify({ logger: false });
    await app.register(sensible);
    await app.register(errorHandlerPlugin);
    app.post('/enqueue', async () => addWithinDeadline(fakeQueue(new FakeClient('ready')), never, 40));

    const res = await app.inject({ method: 'POST', url: '/enqueue' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Background job queue is unavailable; retry shortly',
    });
    await app.close();
  });
});
