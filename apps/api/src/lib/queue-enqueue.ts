import type { Queue } from 'bullmq';

// Producer connections use maxRetriesPerRequest: null and an offline queue, so
// BullMQ's add waits without limit for a missing Redis and for one that
// accepted the connection but stopped answering. Requests that await an
// enqueue would hang after their own writes committed, and a client retry
// would then repeat those writes.
export const QUEUE_ENQUEUE_TIMEOUT_MS = 2_000;

export type QueueUnavailableReason = 'not-ready' | 'timed-out';

export class QueueUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = 'QUEUE_UNAVAILABLE';

  constructor(
    readonly queueName: string,
    readonly reason: QueueUnavailableReason,
    readonly timeoutMs: number,
  ) {
    super('Background job queue is unavailable; retry shortly');
    this.name = 'QueueUnavailableError';
  }
}

export function isQueueUnavailableError(err: unknown): err is QueueUnavailableError {
  return err instanceof QueueUnavailableError;
}

type ReadyEmitter = {
  status: string;
  once(event: 'ready', fn: () => void): unknown;
  off(event: 'ready', fn: () => void): unknown;
};

function settleBy<T>(work: Promise<T>, deadline: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function waitForReady(queue: Queue, deadline: number, notReady: () => Error): Promise<void> {
  const client = await settleBy(queue.client as unknown as Promise<ReadyEmitter>, deadline, notReady);
  if (client.status === 'ready') return;
  let onReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    onReady = resolve;
    client.once('ready', onReady);
  });
  try {
    await settleBy(ready, deadline, notReady);
  } finally {
    client.off('ready', onReady);
  }
}

/**
 * Runs `add` against `queue` within one deadline covering both the wait for
 * Redis and the command itself. Throws QueueUnavailableError when it runs out:
 * 'not-ready' means add was never called, so nothing can be queued later;
 * 'timed-out' means add was sent and may still land if Redis recovers, so the
 * job must be safe to run without the caller's bookkeeping.
 */
export async function addWithinDeadline<T>(
  queue: Queue,
  add: () => Promise<T>,
  timeoutMs: number = QUEUE_ENQUEUE_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  await waitForReady(queue, deadline, () => new QueueUnavailableError(queue.name, 'not-ready', timeoutMs));
  return settleBy(add(), deadline, () => new QueueUnavailableError(queue.name, 'timed-out', timeoutMs));
}
