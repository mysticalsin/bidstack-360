// Integration tests — POST /api/v1/migrations/start-hubspot
//
// WHY: like start-csv, the route built its queue from `server.redis`, which
// nothing decorates, so every HubSpot import start answered 500. A start must
// queue every requested entity, or answer a retryable 503 within the enqueue
// deadline and leave no job row and no audit row behind. Entities must not
// half-start: the client retries a 5xx once, and a partly queued start would
// import the first entities twice.

import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import { MIGRATION } from '@bidstack/shared';

import type * as SerumPolicy from '../lib/serum-connector-policy.js';
import { QueueUnavailableError } from '../lib/queue-enqueue.js';
import { buildServer } from '../server.js';
import { makeMigrationsTestContext } from './migrations.test-helpers.js';

// The SERUM connector policy is its own gate with its own tests; here it allows the start.
vi.mock('../lib/serum-connector-policy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SerumPolicy>()),
  assertSerumConnectorAllowed: vi.fn(async () => ({ allowed: true })),
}));

const { ctx, skipIfNoDb } = makeMigrationsTestContext();

const DISCOVERY = { companies: 120, contacts: 40, deals: 7 };
let createdConfigId: string | null = null;
let previousConfig: { id: string; config: unknown; isActive: boolean; deletedAt: Date | null } | null = null;
let inspector: { queue: Queue; connection: IORedis } | null = null;
const queuedJobIds: string[] = [];

function inspectQueue(): Queue {
  if (!inspector) {
    const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', { maxRetriesPerRequest: null });
    inspector = { queue: new Queue(MIGRATION.name, { connection }), connection };
  }
  return inspector.queue;
}

beforeAll(async () => {
  if (!ctx.dbReachable || !ctx.seedOrgId) return;
  const key = { orgId_type_name: { orgId: ctx.seedOrgId, type: 'hubspot' as const, name: 'hubspot-migration' } };
  const existing = await prisma.integrationConfig.findUnique({ where: key });
  if (existing) {
    previousConfig = { id: existing.id, config: existing.config, isActive: existing.isActive, deletedAt: existing.deletedAt };
    await prisma.integrationConfig.update({
      where: { id: existing.id },
      data: { config: { discovery: DISCOVERY }, isActive: true, deletedAt: null },
    });
  } else {
    const created = await prisma.integrationConfig.create({
      data: { orgId: ctx.seedOrgId, type: 'hubspot', name: 'hubspot-migration', config: { discovery: DISCOVERY } },
    });
    createdConfigId = created.id;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  if (inspector) {
    for (const id of queuedJobIds) await inspector.queue.remove(id).catch(() => undefined);
    await inspector.queue.close();
    inspector.connection.disconnect();
  }
  if (!ctx.dbReachable) return;
  // integration_configs is soft-deleted by the client extension, and the
  // (org, type, name) key would then block the next run: remove it outright.
  if (createdConfigId) await prisma.$executeRaw`DELETE FROM integration_configs WHERE id = ${createdConfigId}::uuid`;
  if (previousConfig) {
    await prisma.integrationConfig.update({
      where: { id: previousConfig.id },
      data: {
        config: previousConfig.config as object,
        isActive: previousConfig.isActive,
        deletedAt: previousConfig.deletedAt,
      },
    });
  }
});

function startHubspot(
  entities: string[],
  server = ctx.server,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/migrations/start-hubspot',
    headers,
    payload: { entities, dedupStrategy: 'update', ...extra },
  });
}

async function hubspotRowsSince(since: Date) {
  const [jobs, audits] = await Promise.all([
    prisma.migrationJob.count({ where: { orgId: ctx.seedOrgId!, source: 'HUBSPOT_OAUTH', createdAt: { gte: since } } }),
    prisma.auditLog.count({
      where: {
        orgId: ctx.seedOrgId!,
        action: 'migration.start',
        at: { gte: since },
        diff: { path: ['source'], equals: 'HUBSPOT_OAUTH' },
      },
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

describe('POST /api/v1/migrations/start-hubspot', () => {
  skipIfNoDb('queues the first chunk of every entity and records one RUNNING job and one audit row each', async () => {
    const res = await startHubspot(['companies', 'contacts']);

    expect(res.statusCode).toBe(201);
    const { jobs } = res.json<{ jobs: Array<{ id: string; status: string; totalRows: number }> }>();
    ctx.cleanup.jobIds.push(...jobs.map((j) => j.id));
    expect(jobs.map((j) => [j.status, j.totalRows])).toEqual([
      ['RUNNING', 120],
      ['RUNNING', 40],
    ]);

    const chunkIds = [`${jobs[0]!.id}-companies-chunk-0`, `${jobs[1]!.id}-contacts-chunk-0`];
    queuedJobIds.push(...chunkIds);
    const chunks = await Promise.all(chunkIds.map((id) => inspectQueue().getJob(id)));
    expect(chunks.map((c) => [c?.data.entityType, c?.data.migrationJobId])).toEqual([
      ['companies', jobs[0]!.id],
      ['contacts', jobs[1]!.id],
    ]);
    expect(JSON.stringify(chunks.map((c) => c?.data))).not.toMatch(/accessToken|refreshToken/);

    expect(
      await prisma.auditLog.count({ where: { action: 'migration.start', targetId: { in: jobs.map((j) => j.id) } } }),
    ).toBe(2);
  });

  skipIfNoDb('answers 503 and leaves no job or audit row when the enqueue never answers, across the client retry', async () => {
    vi.spyOn(Queue.prototype, 'addBulk').mockImplementation(never);
    vi.spyOn(Queue.prototype, 'add').mockImplementation(never);
    const since = new Date();

    const started = Date.now();
    const first = await startHubspot(['companies', 'contacts', 'deals']);
    const retry = await startHubspot(['companies', 'contacts', 'deals']);

    expect([first.statusCode, retry.statusCode]).toEqual([503, 503]);
    expect(first.json<{ message: string }>().message).toBe('Background job queue is unavailable; retry shortly');
    expect(Date.now() - started).toBeLessThan(8_000);
    expect(await hubspotRowsSince(since)).toEqual({ jobs: 0, audits: 0 });
  });

  skipIfNoDb('never half-starts: when the enqueue fails, no entity is queued or recorded', async () => {
    const addBulk = vi.spyOn(Queue.prototype, 'addBulk').mockRejectedValue(new Error('ERR synthetic failure'));
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('ERR synthetic failure'));
    const since = new Date();

    const res = await startHubspot(['companies', 'contacts']);

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(add).not.toHaveBeenCalled();
    expect(addBulk).toHaveBeenCalledOnce();
    expect(addBulk.mock.calls[0]![0].map((j) => j.data.entityType)).toEqual(['companies', 'contacts']);
    expect(await hubspotRowsSince(since)).toEqual({ jobs: 0, audits: 0 });
  });
});

const fresh: Array<Awaited<ReturnType<typeof buildServer>>> = [];
/** start-hubspot allows 5 starts a minute per server; each of these tests gets its own. */
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

/** The job rows of the start made with this uploadId; registered for cleanup. */
async function startRows(uploadId: string) {
  const rows = await prisma.migrationJob.findMany({
    where: { orgId: ctx.seedOrgId!, meta: { path: ['uploadId'], equals: uploadId } },
    orderBy: { createdAt: 'asc' },
  });
  ctx.cleanup.jobIds.push(...rows.map((r) => r.id));
  return rows;
}

/** Queued chunks, in any state, of these job rows; registered for cleanup. */
async function chunksOf(jobIds: string[]) {
  const all = await inspectQueue().getJobs(['waiting', 'delayed', 'paused', 'prioritized', 'active', 'completed', 'failed']);
  const mine = all.filter((j) => jobIds.includes(j.data.migrationJobId));
  queuedJobIds.push(...mine.map((j) => j.id!));
  return mine.map((j) => j.id).sort();
}

function jobIdsOf(res: { json: <T>() => T }) {
  const ids = res.json<{ jobs: Array<{ id: string }> }>().jobs.map((j) => j.id);
  ctx.cleanup.jobIds.push(...ids);
  return ids;
}

// WHY: once the first chunks are queued the import runs. If a database write
// after the enqueue failed, the start answered 500 and the client's retry
// created new jobs and imported every entity again. The retry carries the
// same uploadId and must resume the first start instead.
describe('POST /api/v1/migrations/start-hubspot — retried start', () => {
  skipIfNoDb('a retry after a database failure past the enqueue resumes the first start, imported once', async () => {
    const uploadId = randomUUID();
    const server = await freshServer();
    vi.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('synthetic database failure'));

    const first = await startHubspot(['companies', 'contacts'], server, { uploadId });
    const retry = await startHubspot(['companies', 'contacts'], server, { uploadId });

    expect([first.statusCode, retry.statusCode]).toEqual([500, 201]);
    const ids = jobIdsOf(retry);
    const rows = await startRows(uploadId);
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(await chunksOf(ids)).toEqual([`${ids[0]}-companies-chunk-0`, `${ids[1]}-contacts-chunk-0`].sort());
    expect(await prisma.auditLog.count({ where: { action: 'migration.start', targetId: { in: ids } } })).toBe(2);
  });

  skipIfNoDb('a retry of a start that already succeeded returns that start and queues nothing new', async () => {
    const uploadId = randomUUID();
    const server = await freshServer();

    const first = await startHubspot(['deals'], server, { uploadId });
    const again = await startHubspot(['deals'], server, { uploadId });

    expect([first.statusCode, again.statusCode]).toEqual([201, 201]);
    const ids = jobIdsOf(first);
    expect(jobIdsOf(again)).toEqual(ids);
    expect((await startRows(uploadId)).map((r) => r.id)).toEqual(ids);
    expect(await chunksOf(ids)).toEqual([`${ids[0]}-deals-chunk-0`]);
    expect(await prisma.auditLog.count({ where: { action: 'migration.start', targetId: { in: ids } } })).toBe(1);
  });

  skipIfNoDb('an uploadId reused for other entities is refused', async () => {
    const uploadId = randomUUID();
    const server = await freshServer();

    const first = await startHubspot(['deals'], server, { uploadId });
    const other = await startHubspot(['companies'], server, { uploadId });

    expect([first.statusCode, other.statusCode]).toEqual([201, 409]);
    jobIdsOf(first);
    expect(await startRows(uploadId)).toHaveLength(1);
  });

  // WHY: a client that times out retries while its first request is still
  // running; both requests found no earlier start and both imported.
  skipIfNoDb('two parallel requests with the same uploadId start one import', async () => {
    const uploadId = randomUUID();
    const server = await freshServer();
    // Both requests reach the job insert together unless one is made to wait for the other.
    const wait = barrier(2, 500);
    const { create, createMany } = prisma.migrationJob;
    vi.spyOn(prisma.migrationJob, 'create').mockImplementation((async (args: unknown) => {
      await wait();
      return create.call(prisma.migrationJob, args as never);
    }) as never);
    vi.spyOn(prisma.migrationJob, 'createMany').mockImplementation((async (args: unknown) => {
      await wait();
      return createMany.call(prisma.migrationJob, args as never);
    }) as never);

    const [a, b] = await Promise.all([
      startHubspot(['deals'], server, { uploadId }),
      startHubspot(['deals'], server, { uploadId }),
    ]);

    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    const ids = jobIdsOf(a);
    expect(jobIdsOf(b)).toEqual(ids);
    expect((await startRows(uploadId)).map((r) => r.id)).toEqual(ids);
    expect(await chunksOf(ids)).toEqual([`${ids[0]}-deals-chunk-0`]);
    expect(await prisma.auditLog.count({ where: { action: 'migration.start', targetId: { in: ids } } })).toBe(1);
  });

  skipIfNoDb('a duplicate that misses the earlier start is refused by the unique index', async () => {
    const uploadId = randomUUID();
    const server = await freshServer();

    const first = await startHubspot(['deals'], server, { uploadId });
    vi.spyOn(prisma.migrationJob, 'findMany').mockResolvedValueOnce([]);
    const dup = await startHubspot(['deals'], server, { uploadId });

    expect([first.statusCode, dup.statusCode]).toEqual([201, 409]);
    expect(dup.json<{ message: string }>().message).toBe('A start with this uploadId already exists; retry to resume it');
    const ids = jobIdsOf(first);
    expect((await startRows(uploadId)).map((r) => r.id)).toEqual(ids);
    expect(await chunksOf(ids)).toHaveLength(1);
  });
});

// WHY: the key was looked up across the org, so a second user who reused a
// pending uploadId resumed and finished the first user's start. A reused key
// with another request must never resume a start.
describe('POST /api/v1/migrations/start-hubspot — uploadId scope and content', () => {
  skipIfNoDb('another user in the org cannot take over a pending start by reusing its uploadId', async () => {
    vi.stubEnv('BIDSTACK_ALLOW_STUB_ROLE_HEADER', 'true');
    const uploadId = randomUUID();
    const server = await freshServer();
    vi.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('synthetic database failure'));
    expect((await startHubspot(['deals'], server, { uploadId })).statusCode).toBe(500);
    vi.restoreAllMocks();
    const [mine] = await startRows(uploadId);

    const theirs = await startHubspot(['deals'], server, { uploadId }, { 'x-bidstack-e2e-role': 'admin' });

    expect(theirs.statusCode).toBe(201);
    const theirIds = jobIdsOf(theirs);
    expect(theirIds).not.toContain(mine!.id);
    expect(await prisma.auditLog.count({ where: { action: 'migration.start', targetId: mine!.id } })).toBe(0);
    const theirRows = await prisma.migrationJob.findMany({ where: { id: { in: theirIds } } });
    expect(theirRows.map((r) => r.userId)).not.toContain(mine!.userId);
    await chunksOf([mine!.id, ...theirIds]);
  });

  skipIfNoDb('the same user reusing an uploadId with another request is refused', async () => {
    const uploadId = randomUUID();
    const server = await freshServer();

    const first = await startHubspot(['deals'], server, { uploadId });
    const other = await startHubspot(['deals'], server, { uploadId, dedupStrategy: 'skip' });

    expect([first.statusCode, other.statusCode]).toEqual([201, 409]);
    expect(other.json<{ message: string }>().message).toBe('uploadId was already used for a different upload');
    jobIdsOf(first);
    expect(await startRows(uploadId)).toHaveLength(1);
  });
});

// WHY: a resume re-adds nothing only while BullMQ still holds the first
// chunk (7 days, last 500 completed). Past that it imports the entity again
// from its first page, so it must at least say so.
describe('POST /api/v1/migrations/start-hubspot — resume past the queue retry window', () => {
  skipIfNoDb('warns when the first chunks are no longer in the queue, and still resumes', async () => {
    const uploadId = randomUUID();
    const server = await buildServer();
    const warnings: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    server.addHook('onRequest', async (req) => {
      const warn = req.log.warn.bind(req.log);
      req.log.warn = ((obj: Record<string, unknown>, msg: string) => {
        warnings.push({ obj, msg });
        return warn(obj, msg);
      }) as typeof req.log.warn;
    });
    await server.ready();
    fresh.push(server);
    vi.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('synthetic database failure'));
    expect((await startHubspot(['companies', 'contacts'], server, { uploadId })).statusCode).toBe(500);
    const rows = await startRows(uploadId);
    const chunkIds = [`${rows[0]?.id}-companies-chunk-0`, `${rows[1]?.id}-contacts-chunk-0`];
    for (const id of chunkIds) await inspectQueue().remove(id);

    const retry = await startHubspot(['companies', 'contacts'], server, { uploadId });

    expect(retry.statusCode).toBe(201);
    const past = warnings.filter((w) => /past the queue retry window/.test(w.msg));
    expect(past.map((w) => w.obj.missingChunks)).toEqual(chunkIds.map((id) => [id]));
    expect(await chunksOf(jobIdsOf(retry))).toEqual([...chunkIds].sort());
  });
});

describe('POST /api/v1/migrations/start-hubspot — failed cleanup', () => {
  // WHY: a throwing cleanup replaced the start's own error, turning a
  // retryable 503 into a 500.
  skipIfNoDb('keeps the original 503 when the job rows cannot be deleted', async () => {
    vi.spyOn(Queue.prototype, 'addBulk').mockRejectedValue(new QueueUnavailableError(MIGRATION.name, 'not-ready', 2_000));
    vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new QueueUnavailableError(MIGRATION.name, 'not-ready', 2_000));
    vi.spyOn(prisma.migrationJob, 'deleteMany').mockRejectedValue(new Error('synthetic database failure'));
    const since = new Date();

    const res = await startHubspot(['companies']);

    expect(res.statusCode).toBe(503);
    expect(res.json<{ message: string }>().message).toBe('Background job queue is unavailable; retry shortly');
    vi.restoreAllMocks();
    const left = await prisma.migrationJob.findMany({
      where: { orgId: ctx.seedOrgId!, source: 'HUBSPOT_OAUTH', createdAt: { gte: since } },
    });
    ctx.cleanup.jobIds.push(...left.map((j) => j.id));
    expect(left).toHaveLength(1);
  });
});

describe('HubSpot migration routes on server close', () => {
  skipIfNoDb('close the migration queue and quit its Redis connection', async () => {
    const server = await buildServer();
    await server.ready();
    const res = await startHubspot(['deals'], server);
    expect(res.statusCode).toBe(201);
    const { jobs } = res.json<{ jobs: Array<{ id: string }> }>();
    ctx.cleanup.jobIds.push(...jobs.map((j) => j.id));
    queuedJobIds.push(`${jobs[0]!.id}-deals-chunk-0`);
    const close = vi.spyOn(Queue.prototype, 'close');

    await server.close();

    const closed = close.mock.contexts.filter((q) => (q as Queue).name === MIGRATION.name && q !== inspector?.queue);
    expect(closed).toHaveLength(1);
    await waitForEnd((closed[0] as Queue).opts.connection as IORedis);
  });

  // WHY: the hook quit the connection only after a successful queue close, so
  // a failing close left the connection open.
  skipIfNoDb('quit the Redis connection even when closing the queue fails', async () => {
    const server = await buildServer();
    await server.ready();
    const res = await startHubspot(['deals'], server);
    expect(res.statusCode).toBe(201);
    const { jobs } = res.json<{ jobs: Array<{ id: string }> }>();
    ctx.cleanup.jobIds.push(...jobs.map((j) => j.id));
    queuedJobIds.push(`${jobs[0]!.id}-deals-chunk-0`);
    const close = vi.spyOn(Queue.prototype, 'close').mockRejectedValue(new Error('synthetic close failure'));

    await server.close().catch(() => undefined);

    const closed = close.mock.contexts.filter((q) => (q as Queue).name === MIGRATION.name && q !== inspector?.queue);
    expect(closed).toHaveLength(1);
    await waitForEnd((closed[0] as Queue).opts.connection as IORedis);
  });
});
