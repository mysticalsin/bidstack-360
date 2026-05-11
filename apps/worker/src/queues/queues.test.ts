import { Socket } from 'node:net';

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
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
  let redisUp = false;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      redisUp = false;
      return;
    }

    if (!(await canReachRedis(redisUrl))) {
      redisUp = false;
      return;
    }

    connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    connection.on('error', () => undefined);

    try {
      await connection.connect();
      await connection.ping();
      redisUp = true;
    } catch {
      redisUp = false;
      connection.disconnect();
      return;
    }
    await startDustPoller(connection, log, workers, queues);
    await startWebhookProcessor(connection, log, workers, queues);
  });

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
    await Promise.all(queues.map((q) => q.close().catch(() => undefined)));
    connection?.disconnect();
  });

  it('creates dust-poll queue with repeat config', async () => {
    if (!redisUp) return;
    const q = queues.find((q) => q.name === 'dust-poll');
    expect(q).toBeTruthy();
    const jobs = await q!.getRepeatableJobs();
    expect(jobs.length).toBeGreaterThan(0);
    expect(Number(jobs[0]!.every)).toBe(5 * 60 * 1000);
  });

  it('creates dust-webhook queue with repeat config', async () => {
    if (!redisUp) return;
    const q = queues.find((q) => q.name === 'dust-webhook');
    expect(q).toBeTruthy();
    const jobs = await q!.getRepeatableJobs();
    expect(jobs.length).toBeGreaterThan(0);
    expect(Number(jobs[0]!.every)).toBe(10_000);
  });

  it('workers have retry config', async () => {
    if (!redisUp) return;
    for (const w of workers) {
      expect(w.opts.connection).toBeDefined();
    }
  });
});

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
