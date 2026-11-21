// Request-path BullMQ producers. Workers may block forever on a connection.
// A route must not: ioredis defaults (offline queue on, retries unbounded)
// leave Queue.add() pending for the life of the process.
import { Queue, type DefaultJobOptions, type QueueOptions } from 'bullmq';
import IORedis, { type Redis, type RedisOptions } from 'ioredis';

import { waitForRedisClient } from '../redis.js';

/** Connect budget and per-command budget for a producer used on a request. */
export const QUEUE_PRODUCER_TIMEOUT_MS = 1_000;

export const ENRICHMENT_QUEUED_MESSAGE = 'Enrichment queued';
export const ENRICHMENT_FAILED_MESSAGE = 'Enrichment queued later or failed';

export function queueProducerRedisOptions(timeoutMs = QUEUE_PRODUCER_TIMEOUT_MS): RedisOptions {
  return {
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
    // A command issued while the socket is down rejects. With the offline
    // queue left on, that command waits through every reconnect and the
    // HTTP handler never finishes.
    enableOfflineQueue: false,
    // BullMQ Queue throws if this is a positive number (it treats the client
    // as a blocking worker connection). Null is the setting it allows.
    // The request bound is the ready wait plus commandTimeout.
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 50, 200),
  };
}

export function queueProducerUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL ?? 'redis://localhost:6380';
}

export function openQueueProducer(url = queueProducerUrl(), timeoutMs = QUEUE_PRODUCER_TIMEOUT_MS): Redis {
  const client = new IORedis(url, queueProducerRedisOptions(timeoutMs));
  // A refused connect emits 'error'. Without a listener Node reports it as
  // unhandled. Callers add their own log listener beside this one.
  client.on('error', () => undefined);
  return client;
}

/** True once the client can take a command, or false when `timeoutMs` elapses. */
export function whenProducerReady(client: Redis, timeoutMs = QUEUE_PRODUCER_TIMEOUT_MS): Promise<boolean> {
  return waitForRedisClient(client, timeoutMs);
}

export interface ProducerHandle {
  /** The live queue, or null when Redis does not become ready inside the budget. */
  ready(defaultJobOptions?: DefaultJobOptions): Promise<Queue | null>;
  close(): Promise<void>;
}

/**
 * One producer connection and its BullMQ queue. The queue is constructed only
 * after Redis is ready, so a down socket never receives a command that would
 * sit in the offline queue.
 */
export function createProducerHandle(
  queueName: string,
  onError: (err: Error) => void,
  timeoutMs = QUEUE_PRODUCER_TIMEOUT_MS,
): ProducerHandle {
  let queue: Queue | null = null;
  let connection: Redis | null = null;

  return {
    async ready(defaultJobOptions?: DefaultJobOptions): Promise<Queue | null> {
      if (!connection || connection.status === 'end') {
        connection = openQueueProducer(queueProducerUrl(), timeoutMs);
        connection.on('error', onError);
        queue = null;
      }
      const up = await whenProducerReady(connection, timeoutMs);
      if (!up) return null;
      if (!queue) {
        const options: QueueOptions = {
          connection,
          ...(defaultJobOptions ? { defaultJobOptions } : {}),
        };
        queue = new Queue(queueName, options);
      }
      return queue;
    },
    async close(): Promise<void> {
      const currentQueue = queue;
      const currentConnection = connection;
      queue = null;
      connection = null;
      currentConnection?.disconnect();
      await Promise.race([
        currentQueue?.close().catch(() => undefined),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 500);
        }),
      ]);
    },
  };
}
