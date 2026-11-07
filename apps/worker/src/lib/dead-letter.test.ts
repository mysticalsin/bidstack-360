import { EventEmitter } from 'node:events';

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { attachDeadLetter, DEAD_LETTER_QUEUE, deadLetterJobId, isFinalAttempt } from './dead-letter.js';

const log = pino({ level: 'silent' });

function fakeWorker(name: string) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { name }) as unknown as EventEmitter & {
    name: string;
    on: (event: string, cb: (...args: unknown[]) => void) => unknown;
  };
}

function job(attemptsMade: number, attempts?: number) {
  return { id: 'j1', name: 'work', data: { orgId: 'o1' }, attemptsMade, opts: { attempts } };
}

describe('dead-letter', () => {
  it('only the last attempt is final', () => {
    expect(isFinalAttempt(job(1, 3))).toBe(false);
    expect(isFinalAttempt(job(3, 3))).toBe(true);
    expect(isFinalAttempt(job(1))).toBe(true);
  });

  it('copies an exhausted job with a deterministic id', async () => {
    const worker = fakeWorker('tenant-export');
    const add = vi.fn(async () => undefined);
    attachDeadLetter(worker as never, { add } as never, log);

    worker.emit('failed', job(1, 3), new Error('transient'));
    expect(add).not.toHaveBeenCalled();

    worker.emit('failed', job(3, 3), new Error('storage down'));
    expect(add).toHaveBeenCalledTimes(1);
    const [name, entry, opts] = add.mock.calls[0] as unknown as [string, Record<string, unknown>, { jobId: string }];
    expect(name).toBe('dead-letter');
    expect(entry).toMatchObject({
      queue: 'tenant-export',
      jobId: 'j1',
      data: { orgId: 'o1' },
      failedReason: 'storage down',
      attemptsMade: 3,
    });
    expect(opts.jobId).toBe(deadLetterJobId('tenant-export', { id: 'j1' }));
    expect(opts.jobId).not.toContain(':');
  });

  it('survives a dead-letter enqueue failure and never dead-letters itself', async () => {
    const worker = fakeWorker('sms');
    const add = vi.fn(async () => {
      throw new Error('redis down');
    });
    attachDeadLetter(worker as never, { add } as never, log);
    expect(() => worker.emit('failed', job(1, 1), new Error('x'))).not.toThrow();
    await new Promise((r) => setImmediate(r));

    const dlqWorker = fakeWorker(DEAD_LETTER_QUEUE);
    const add2 = vi.fn(async () => undefined);
    attachDeadLetter(dlqWorker as never, { add: add2 } as never, log);
    dlqWorker.emit('failed', job(1, 1), new Error('x'));
    expect(add2).not.toHaveBeenCalled();
  });
});
