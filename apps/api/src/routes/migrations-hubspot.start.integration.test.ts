// Integration tests — POST /api/v1/migrations/start-hubspot
//
// WHY: like start-csv, the route built its queue from `server.redis`, which
// nothing decorates, so every HubSpot import start answered 500. A start must
// queue every requested entity, or answer a retryable 503 within the enqueue
// deadline and leave no job row and no audit row behind. Entities must not
// half-start: the client retries a 5xx once, and a partly queued start would
// import the first entities twice.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import { MIGRATION } from '@bidstack/shared';

import type * as SerumPolicy from '../lib/serum-connector-policy.js';
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

function startHubspot(entities: string[]) {
  return ctx.server.inject({
    method: 'POST',
    url: '/api/v1/migrations/start-hubspot',
    payload: { entities, dedupStrategy: 'update' },
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
