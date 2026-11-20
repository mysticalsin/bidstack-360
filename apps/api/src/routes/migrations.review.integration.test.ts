// Cursor review of the same-import start: a failed open must not leave a
// Redis client reconnecting, a throw before RUNNING must free the slot, and
// a claim that does not land must not enqueue chunks.

import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';
import { retireActiveImports } from './migrations.test-helpers.js';

let server: FastifyInstance;
let org: IsolatedOrg;
let restoreAuth: () => void;
let dbReachable = false;
let userId: string;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('migration-review');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const user = await prisma.user.findFirst({
    where: { orgId: org.orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!user) throw new Error('isolated org has no user');
  userId = user.id;
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
});

beforeEach(async () => {
  if (org) await retireActiveImports(org.orgId);
});

const t = (name: string, fn: () => Promise<void>, timeout = 15_000) =>
  it(
    name,
    async () => {
      if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
      await fn();
    },
    timeout,
  );

const startBody = {
  source: 'CSV' as const,
  entityType: 'company',
  rows: [{ name: 'Acme' }],
  mappings: { name: 'company.name' },
};

async function failedCsvJob() {
  const job = await prisma.migrationJob.create({
    data: {
      orgId: org.orgId,
      userId,
      source: 'CSV',
      status: 'FAILED',
      totalRows: 1,
      completedAt: new Date(),
      meta: { entityType: 'company', dedupStrategy: 'update', mappings: { name: 'company.name' } },
    },
  });
  await server.redis.set(`migration:${job.id}:company:rows`, JSON.stringify([{ name: 'Acme' }]), 'EX', 3600);
  return job;
}

describe('migration review gates', () => {
  t('a queue that never becomes ready does not leave a client reconnecting', async () => {
    // WHY: getQueue opens its own Redis client. A failed ready check used to
    // drop the reference and leave retryStrategy reconnecting.
    const { redis } = await import('../redis.js');
    const duplicate = redis.duplicate.bind(redis);
    const opened: Redis[] = [];
    let closed = 0;
    const originalClose = Queue.prototype.close;
    const close = vi.spyOn(Queue.prototype, 'close').mockImplementation(function (this: Queue, ...args) {
      closed += 1;
      return originalClose.apply(this, args);
    });
    const spy = vi.spyOn(redis, 'duplicate').mockImplementation((override) => {
      const connection = duplicate({
        ...(override ?? {}),
        host: '127.0.0.1',
        port: 1,
        lazyConnect: true,
        retryStrategy: () => 50,
      });
      connection.on('error', () => undefined);
      opened.push(connection);
      return connection;
    });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: startBody,
      });
      expect(res.statusCode).toBe(409);
      expect(opened.length).toBeGreaterThan(0);
      expect(closed).toBeGreaterThan(0);
      expect(opened.every((connection) => connection.status === 'end')).toBe(true);
    } finally {
      spy.mockRestore();
      close.mockRestore();
      for (const connection of opened) connection.disconnect();
    }
  }, 20_000);

  t('a mapping failure releases the pending slot', async () => {
    // WHY: the row is created before the mapping upsert. A throw there used
    // to leave PENDING, which blocks the same file for the sweep window.
    const upsert = vi.spyOn(prisma.migrationMapping, 'upsert').mockRejectedValue(new Error('mapping down'));
    const before = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: startBody,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      upsert.mockRestore();
    }
    expect(
      await prisma.migrationJob.count({ where: { orgId: org.orgId, status: 'PENDING' } }),
    ).toBe(before);
    const job = await prisma.migrationJob.findFirstOrThrow({
      where: { orgId: org.orgId },
      orderBy: { createdAt: 'desc' },
    });
    expect(job.status).toBe('FAILED');
    expect(JSON.stringify(job.errorSummary)).not.toContain('Acme');
  });

  t('a start audit failure releases the pending slot before any chunk is queued', async () => {
    const original = prisma.auditLog.create.bind(prisma.auditLog);
    const create = vi.spyOn(prisma.auditLog, 'create').mockImplementation((args) => {
      if (args?.data?.action === 'migration.start') return Promise.reject(new Error('audit down'));
      return original(args);
    });
    const add = vi.spyOn(Queue.prototype, 'addBulk');
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: startBody,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(add).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
      add.mockRestore();
    }
    const job = await prisma.migrationJob.findFirstOrThrow({
      where: { orgId: org.orgId },
      orderBy: { createdAt: 'desc' },
    });
    expect(job.status).toBe('FAILED');
  });

  t('a claim that throws releases the pending slot and does not enqueue', async () => {
    const original = prisma.migrationJob.updateMany.bind(prisma.migrationJob);
    const update = vi.spyOn(prisma.migrationJob, 'updateMany').mockImplementation((args) => {
      const status = (args?.data as { status?: string } | undefined)?.status;
      if (status === 'RUNNING') return Promise.reject(new Error('claim down'));
      return original(args);
    });
    const add = vi.spyOn(Queue.prototype, 'addBulk');
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: startBody,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(add).not.toHaveBeenCalled();
    } finally {
      update.mockRestore();
      add.mockRestore();
    }
    const job = await prisma.migrationJob.findFirstOrThrow({
      where: { orgId: org.orgId },
      orderBy: { createdAt: 'desc' },
    });
    expect(job.status).toBe('FAILED');
  });

  t('a retry whose claim does not land does not enqueue a chunk', async () => {
    // WHY: enqueue used to run first. The claim then returned 409, and the
    // chunk retried five times against a job that was not RUNNING.
    const created = await failedCsvJob();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION skip_failed_to_running() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        IF OLD.status::text = 'FAILED' AND NEW.status::text = 'RUNNING' THEN
          RETURN NULL;
        END IF;
        RETURN NEW;
      END;
      $fn$;
    `);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER skip_failed_to_running BEFORE UPDATE ON migration_jobs FOR EACH ROW EXECUTE FUNCTION skip_failed_to_running()`,
    );
    const add = vi.spyOn(Queue.prototype, 'addBulk').mockResolvedValue([] as never);
    try {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${created.id}/retry`,
      });
      expect(res.statusCode).toBe(409);
      expect(add).not.toHaveBeenCalled();
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.status).toBe('FAILED');
    } finally {
      add.mockRestore();
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS skip_failed_to_running ON migration_jobs`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS skip_failed_to_running()`);
    }
  });
});
