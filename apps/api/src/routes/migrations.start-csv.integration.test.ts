// Integration tests — POST /api/v1/migrations/start-csv
//
// WHY: the route read `server.redis`, which nothing decorates, so every start
// answered 500 after it had already written a PENDING job and an audit row.
// The web client retries a mutation once on 5xx, so each click left two
// orphan jobs and two audit rows (QA, reproduced on 4bb5 and 0be8). A start
// must either queue the import or leave no job, no audit row and no stored rows.

import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, afterEach, describe, expect, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import { MIGRATION } from '@bidstack/shared';

import { redis } from '../redis.js';
import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb } = makeMigrationsTestContext();

let inspector: { queue: Queue; connection: IORedis } | null = null;
function inspectQueue(): Queue {
  if (!inspector) {
    const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', { maxRetriesPerRequest: null });
    inspector = { queue: new Queue(MIGRATION.name, { connection }), connection };
  }
  return inspector.queue;
}

const queuedJobIds: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (inspector) {
    for (const id of queuedJobIds) await inspector.queue.remove(id).catch(() => undefined);
    await inspector.queue.close();
    inspector.connection.disconnect();
  }
});

function startCsv(entityType: string, rowCount = 3) {
  return ctx.server.inject({
    method: 'POST',
    url: '/api/v1/migrations/start-csv',
    payload: {
      source: 'CSV',
      entityType,
      rows: Array.from({ length: rowCount }, (_, i) => ({ Name: `Synthetic Import Co ${i}` })),
      mappings: { Name: 'name' },
    },
  });
}

async function leftovers(entityType: string) {
  const [jobs, audits] = await Promise.all([
    prisma.migrationJob.count({ where: { orgId: ctx.seedOrgId!, meta: { path: ['entityType'], equals: entityType } } }),
    prisma.auditLog.count({
      where: { orgId: ctx.seedOrgId!, action: 'migration.start', diff: { path: ['entityType'], equals: entityType } },
    }),
  ]);
  return { jobs, audits };
}

const never = () => new Promise<never>(() => {});

describe('POST /api/v1/migrations/start-csv', () => {
  skipIfNoDb('queues every chunk, stores the rows and records one RUNNING job with one audit row', async () => {
    const res = await startCsv('company', 250);

    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; status: string; totalRows: number }>();
    ctx.cleanup.jobIds.push(body.id);
    expect(body.status).toBe('RUNNING');
    expect(body.totalRows).toBe(250);

    const stored = await redis.get(`migration:${body.id}:company:rows`);
    expect(JSON.parse(stored ?? '[]')).toHaveLength(250);

    const chunkIds = [0, 1, 2].map((i) => `${body.id}-company-chunk-${i}`);
    queuedJobIds.push(...chunkIds);
    const chunks = await Promise.all(chunkIds.map((id) => inspectQueue().getJob(id)));
    expect(chunks.map((c) => c?.data.chunkOffset)).toEqual([0, 100, 200]);
    expect(await inspectQueue().getJob(`${body.id}-company-chunk-3`)).toBeUndefined();

    expect(
      await prisma.auditLog.count({ where: { action: 'migration.start', targetId: body.id } }),
    ).toBe(1);
    await redis.del(`migration:${body.id}:company:rows`);
  });

  skipIfNoDb('answers 503 and leaves no job or audit row when the enqueue never answers, across the client retry', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    vi.spyOn(Queue.prototype, 'addBulk').mockImplementation(never);
    vi.spyOn(Queue.prototype, 'add').mockImplementation(never);

    const started = Date.now();
    const first = await startCsv(entityType);
    const retry = await startCsv(entityType);

    expect([first.statusCode, retry.statusCode]).toEqual([503, 503]);
    expect(first.json<{ message: string }>().message).toBe('Background job queue is unavailable; retry shortly');
    expect(Date.now() - started).toBeLessThan(8_000);
    expect(await leftovers(entityType)).toEqual({ jobs: 0, audits: 0 });
    const keys = await redis.keys(`migration:*:${entityType}:rows`);
    expect(keys).toEqual([]);
  });

  skipIfNoDb('answers 503 and leaves nothing behind when the rows cannot be stored, without enqueueing', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    vi.spyOn(redis, 'set').mockRejectedValue(new Error('Command timed out'));
    const addBulk = vi.spyOn(Queue.prototype, 'addBulk');
    const add = vi.spyOn(Queue.prototype, 'add');

    const res = await startCsv(entityType);

    expect(res.statusCode).toBe(503);
    expect(addBulk).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(await leftovers(entityType)).toEqual({ jobs: 0, audits: 0 });
  });

  skipIfNoDb('leaves nothing behind when the enqueue fails with an unexpected error', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    vi.spyOn(Queue.prototype, 'addBulk').mockRejectedValue(new Error('ERR synthetic failure'));
    vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('ERR synthetic failure'));

    const res = await startCsv(entityType);

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(await leftovers(entityType)).toEqual({ jobs: 0, audits: 0 });
    expect(await redis.keys(`migration:*:${entityType}:rows`)).toEqual([]);
  });
});
