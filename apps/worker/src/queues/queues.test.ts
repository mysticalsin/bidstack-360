import { Socket } from 'node:net';

import { describe, expect, it, beforeAll, afterAll } from 'vitest';

process.on('unhandledRejection', (err: unknown) => {
  if (isRedisTeardownNoise(err)) {
    return; // BullMQ/ioredis cleanup noise in test teardown
  }
  throw err;
});
import { type Queue, type Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

import { startDustPoller } from './dust-poll.js';
import { startWebhookProcessor } from './webhook-processor.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

let connection: IORedis | null = null;

const log = pino({ level: 'silent' });

describe('Worker queues', () => {
  const workers: Worker[] = [];
  const queues: Queue[] = [];
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL not set — aborting worker queue tests. (Rule 12: Fail loud)');
    }

    if (!(await canReachRedis(redisUrl))) {
      throw new Error(
        `Redis at ${safeRedisUrl(redisUrl)} not reachable — aborting worker queue tests. (Rule 12: Fail loud)`,
      );
    }

    connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    connection.on('error', () => undefined);

    try {
      await connection.connect();
      await connection.ping();
    } catch (err) {
      connection.disconnect();
      throw new Error('Failed to connect/ping Redis', { cause: err });
    }
    await startDustPoller(connection, log, workers, queues);
    await startWebhookProcessor(connection, log, workers, queues);
    for (const worker of workers) {
      worker.on('error', swallowRedisTeardownNoise);
    }
    for (const queue of queues) {
      queue.on('error', swallowRedisTeardownNoise);
    }
  });

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
    await Promise.all(queues.map((q) => q.close().catch(() => undefined)));
    if (connection) {
      connection.removeAllListeners('error');
      try {
        await connection.quit();
      } catch {
        // ignore
      }
    }
  });

  it('creates dust-poll queue with repeat config', async () => {
    const q = queues.find((q) => q.name === 'dust-poll');
    expect(q).toBeTruthy();
    const jobs = await q!.getRepeatableJobs();
    expect(jobs.length).toBeGreaterThan(0);
    expect(Number(jobs[0]!.every)).toBe(5 * 60 * 1000);
  });

  it('creates dust-webhook queue with repeat config', async () => {
    const q = queues.find((q) => q.name === 'dust-webhook');
    expect(q).toBeTruthy();
    const jobs = await q!.getRepeatableJobs();
    expect(jobs.length).toBeGreaterThan(0);
    expect(Number(jobs[0]!.every)).toBe(10_000);
  });

  it('workers have retry config', async () => {
    for (const w of workers) {
      expect(w.opts.connection).toBeDefined();
    }
  });
});

function isRedisTeardownNoise(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('Connection is closed');
}

function swallowRedisTeardownNoise(err: Error): void {
  if (isRedisTeardownNoise(err)) return;
  throw err;
}

/** Strip credentials from a Redis URL before using it in error messages or logs. */
function safeRedisUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return '[invalid-redis-url]';
  }
}

function canReachRedis(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const host = parsed.hostname || 'localhost';
  const port = Number(parsed.port || 6379);

  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(500);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
    socket.connect(port, host);
  });
}
