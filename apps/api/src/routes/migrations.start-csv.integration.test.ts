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
import { buildServer } from '../server.js';
import { QueueUnavailableError } from '../lib/queue-enqueue.js';
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

function startCsv(entityType: string, rowCount = 3, extra: Record<string, unknown> = {}, server = ctx.server) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/migrations/start-csv',
    payload: {
      source: 'CSV',
      entityType,
      rows: Array.from({ length: rowCount }, (_, i) => ({ Name: `Synthetic Import Co ${i}` })),
      mappings: { Name: 'name' },
      ...extra,
    },
  });
}

/** Chunks queued for this entity type, in any state; registered for cleanup. */
async function queuedChunks(entityType: string) {
  const all = await inspectQueue().getJobs(['waiting', 'delayed', 'paused', 'prioritized', 'active', 'completed', 'failed']);
  const mine = all.filter((j) => j.data.entityType === entityType);
  queuedJobIds.push(...mine.map((j) => j.id!));
  return mine;
}

/** Job rows for this entity type; registered for cleanup. */
async function jobRows(entityType: string) {
  const rows = await prisma.migrationJob.findMany({
    where: { orgId: ctx.seedOrgId!, meta: { path: ['entityType'], equals: entityType } },
  });
  ctx.cleanup.jobIds.push(...rows.map((r) => r.id));
  return rows;
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

/** quit() resolves on Redis's OK; the client reaches 'end' when the socket closes just after. */
async function waitForEnd(connection: IORedis) {
  for (let i = 0; i < 40 && connection.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  expect(connection.status).toBe('end');
}

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

// WHY: once the chunks are queued the import will run. If a database write
// after the enqueue failed, the start answered 500 and the client's one retry
// created a second job and imported every row again. The retry carries the
// same uploadId and must resume the first start instead.
// start-csv allows 10 starts a minute per server; these tests get their own.
let own: Awaited<ReturnType<typeof buildServer>> | null = null;
async function ownServer() {
  if (!own) {
    own = await buildServer();
    await own.ready();
  }
  return own;
}
afterAll(async () => {
  await own?.close();
});

describe('POST /api/v1/migrations/start-csv — retried upload', () => {
  skipIfNoDb('a retry after a database failure past the enqueue resumes the first start, imported once', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    const uploadId = randomUUID();
    vi.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('synthetic database failure'));

    const first = await startCsv(entityType, 150, { uploadId }, await ownServer());
    const retry = await startCsv(entityType, 150, { uploadId }, await ownServer());

    expect(first.statusCode).toBe(500);
    expect(retry.statusCode).toBe(201);
    const jobs = await jobRows(entityType);
    expect(jobs.map((j) => j.id)).toEqual([retry.json<{ id: string }>().id]);
    expect(jobs[0]!.status).toBe('RUNNING');
    const chunks = await queuedChunks(entityType);
    expect(chunks.map((c) => c.id).sort()).toEqual([0, 1].map((i) => `${jobs[0]!.id}-${entityType}-chunk-${i}`));
    expect(await prisma.auditLog.count({ where: { action: 'migration.start', targetId: jobs[0]!.id } })).toBe(1);
    await redis.del(`migration:${jobs[0]!.id}:${entityType}:rows`);
  });

  skipIfNoDb('a retry of a start that already succeeded returns that start and queues nothing new', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    const uploadId = randomUUID();

    const first = await startCsv(entityType, 3, { uploadId }, await ownServer());
    const again = await startCsv(entityType, 3, { uploadId }, await ownServer());

    expect([first.statusCode, again.statusCode]).toEqual([201, 201]);
    expect(again.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(await jobRows(entityType)).toHaveLength(1);
    expect(await queuedChunks(entityType)).toHaveLength(1);
    await redis.del(`migration:${first.json<{ id: string }>().id}:${entityType}:rows`);
  });

  skipIfNoDb('another upload of the same rows is a new import', async () => {
    const entityType = `synthetic-${randomUUID()}`;

    const a = await startCsv(entityType, 3, { uploadId: randomUUID() }, await ownServer());
    const b = await startCsv(entityType, 3, { uploadId: randomUUID() }, await ownServer());

    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(await jobRows(entityType)).toHaveLength(2);
  });

  skipIfNoDb('an uploadId reused for a different upload is refused', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    const uploadId = randomUUID();

    const first = await startCsv(entityType, 3, { uploadId }, await ownServer());
    const other = await startCsv(entityType, 4, { uploadId }, await ownServer());

    expect([first.statusCode, other.statusCode]).toEqual([201, 409]);
    expect(await jobRows(entityType)).toHaveLength(1);
  });
});

const fresh: Array<Awaited<ReturnType<typeof buildServer>>> = [];
/** A server of its own, past the start-csv rate limit the other tests use up. */
async function freshServer() {
  const server = await buildServer();
  await server.ready();
  fresh.push(server);
  return server;
}
afterAll(async () => {
  for (const server of fresh) await server.close();
});

/** Holds each call until `n` calls have arrived or `ms` has passed, then lets them all through. */
function barrier(n: number, ms: number) {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  const timer = setTimeout(release, ms);
  return async () => {
    if (++arrived >= n) {
      clearTimeout(timer);
      release();
    }
    await open;
  };
}

// WHY: a client that times out retries while its first request is still
// running. Both requests found no earlier start, both created a job, and the
// rows were imported twice.
describe('POST /api/v1/migrations/start-csv — concurrent retries', () => {
  skipIfNoDb('two parallel requests with the same uploadId start one import', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    const uploadId = randomUUID();
    const server = await freshServer();
    // Both requests reach the job insert together unless one is made to wait for the other.
    const create = prisma.migrationJob.create;
    const wait = barrier(2, 500);
    vi.spyOn(prisma.migrationJob, 'create').mockImplementation((async (args: unknown) => {
      await wait();
      return create.call(prisma.migrationJob, args as never);
    }) as never);

    const [a, b] = await Promise.all([
      startCsv(entityType, 150, { uploadId }, server),
      startCsv(entityType, 150, { uploadId }, server),
    ]);

    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    const jobs = await jobRows(entityType);
    expect(jobs.map((j) => j.id)).toEqual([a.json<{ id: string }>().id]);
    expect(b.json<{ id: string }>().id).toBe(jobs[0]!.id);
    const chunks = await queuedChunks(entityType);
    expect(chunks.map((c) => c.id).sort()).toEqual([0, 1].map((i) => `${jobs[0]!.id}-${entityType}-chunk-${i}`));
    expect(await prisma.auditLog.count({ where: { action: 'migration.start', targetId: jobs[0]!.id } })).toBe(1);
    await redis.del(`migration:${jobs[0]!.id}:${entityType}:rows`);
  });

  skipIfNoDb('a duplicate that misses the earlier start is refused by the unique index', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    const uploadId = randomUUID();
    const server = await freshServer();

    const first = await startCsv(entityType, 3, { uploadId }, server);
    vi.spyOn(prisma.migrationJob, 'findFirst').mockResolvedValueOnce(null);
    const dup = await startCsv(entityType, 3, { uploadId }, server);

    expect([first.statusCode, dup.statusCode]).toEqual([201, 409]);
    expect(dup.json<{ message: string }>().message).toBe('A start with this uploadId already exists; retry to resume it');
    expect(await jobRows(entityType)).toHaveLength(1);
    expect(await queuedChunks(entityType)).toHaveLength(1);
    await redis.del(`migration:${first.json<{ id: string }>().id}:${entityType}:rows`);
  });

  skipIfNoDb('an uploadId used by another source is refused', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    const uploadId = randomUUID();
    const server = await freshServer();

    const csv = await startCsv(entityType, 3, { uploadId }, server);
    const salesforce = await startCsv(entityType, 3, { uploadId, source: 'SALESFORCE_CSV' }, server);

    expect([csv.statusCode, salesforce.statusCode]).toEqual([201, 409]);
    expect(await jobRows(entityType)).toHaveLength(1);
    await redis.del(`migration:${csv.json<{ id: string }>().id}:${entityType}:rows`);
  });
});

type Warning = { obj: Record<string, unknown>; msg: string };
/** A server of its own whose request loggers record every warning. */
async function watchedServer() {
  const server = await buildServer();
  const warnings: Warning[] = [];
  server.addHook('onRequest', async (req) => {
    const warn = req.log.warn.bind(req.log);
    req.log.warn = ((obj: Record<string, unknown>, msg: string) => {
      warnings.push({ obj, msg });
      return warn(obj, msg);
    }) as typeof req.log.warn;
  });
  await server.ready();
  fresh.push(server);
  return { server, pastWindow: () => warnings.filter((w) => /past the queue retry window/.test(w.msg)) };
}

// WHY: a resume re-adds nothing only while BullMQ still holds the chunks
// (7 days, last 500 completed). Past that it imports rows a second time, so
// it must at least say so.
describe('POST /api/v1/migrations/start-csv — resume past the queue retry window', () => {
  async function failedStart(server: Awaited<ReturnType<typeof buildServer>>, entityType: string, uploadId: string) {
    vi.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('synthetic database failure'));
    expect((await startCsv(entityType, 150, { uploadId }, server)).statusCode).toBe(500);
    const [job] = await jobRows(entityType);
    const chunkIds = [0, 1].map((i) => `${job!.id}-${entityType}-chunk-${i}`);
    queuedJobIds.push(...chunkIds);
    return { job: job!, chunkIds };
  }

  skipIfNoDb('a resume inside the window logs no warning', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    const uploadId = randomUUID();
    const { server, pastWindow } = await watchedServer();
    const { job } = await failedStart(server, entityType, uploadId);

    expect((await startCsv(entityType, 150, { uploadId }, server)).statusCode).toBe(201);
    expect(pastWindow()).toEqual([]);
    await redis.del(`migration:${job.id}:${entityType}:rows`);
  });

  skipIfNoDb('warns when the chunks of the start are no longer in the queue, and still resumes', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    const uploadId = randomUUID();
    const { server, pastWindow } = await watchedServer();
    const { job, chunkIds } = await failedStart(server, entityType, uploadId);
    for (const id of chunkIds) await inspectQueue().remove(id);

    const retry = await startCsv(entityType, 150, { uploadId }, server);

    expect(retry.statusCode).toBe(201);
    expect(pastWindow()).toHaveLength(1);
    expect(pastWindow()[0]!.obj).toMatchObject({ migrationJobId: job.id, missingChunks: chunkIds });
    expect((await queuedChunks(entityType)).map((c) => c.id).sort()).toEqual(chunkIds);
    await redis.del(`migration:${job.id}:${entityType}:rows`);
  });

  skipIfNoDb('warns when the start is older than the 7-day window', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    const uploadId = randomUUID();
    const { server, pastWindow } = await watchedServer();
    const { job } = await failedStart(server, entityType, uploadId);
    await prisma.migrationJob.update({ where: { id: job.id }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });

    expect((await startCsv(entityType, 150, { uploadId }, server)).statusCode).toBe(201);
    expect(pastWindow()).toHaveLength(1);
    expect(pastWindow()[0]!.obj).toMatchObject({ migrationJobId: job.id, missingChunks: [] });
    expect(pastWindow()[0]!.obj.ageMs).toBeGreaterThan(7 * 86_400_000);
    await redis.del(`migration:${job.id}:${entityType}:rows`);
  });
});

// WHY: the cleanup of a failed start ran unguarded; when it threw, its error
// replaced the start's own, so a retryable 503 became a 500 and the stored
// rows were never removed.
describe('POST /api/v1/migrations/start-csv — failed cleanup', () => {
  skipIfNoDb('keeps the original 503 and still removes the stored rows when the job row cannot be deleted', async () => {
    const entityType = `synthetic-${randomUUID()}`;
    vi.spyOn(Queue.prototype, 'addBulk').mockRejectedValue(new QueueUnavailableError(MIGRATION.name, 'not-ready', 2_000));
    vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new QueueUnavailableError(MIGRATION.name, 'not-ready', 2_000));
    vi.spyOn(prisma.migrationJob, 'delete').mockRejectedValue(new Error('synthetic database failure'));

    const res = await startCsv(entityType, 3, {}, await ownServer());

    expect(res.statusCode).toBe(503);
    expect(res.json<{ message: string }>().message).toBe('Background job queue is unavailable; retry shortly');
    expect(await redis.keys(`migration:*:${entityType}:rows`)).toEqual([]);
    expect(await jobRows(entityType)).toHaveLength(1);
  });
});

describe('migration routes on server close', () => {
  skipIfNoDb('close the migration queue and quit its Redis connection', async () => {
    const server = await buildServer();
    await server.ready();
    const entityType = `synthetic-${randomUUID()}`;
    expect((await startCsv(entityType, 3, {}, server)).statusCode).toBe(201);
    await jobRows(entityType);
    await queuedChunks(entityType);
    const close = vi.spyOn(Queue.prototype, 'close');

    await server.close();

    const closed = close.mock.contexts.filter((q) => (q as Queue).name === MIGRATION.name && q !== inspector?.queue);
    expect(closed).toHaveLength(1);
    const connection = (closed[0] as Queue).opts.connection as IORedis;
    await waitForEnd(connection);
  });
});
