// WHY these races matter: a CSV start enqueues chunks and only then writes
// RUNNING by id, so a cancel that lands during enqueue is overwritten and the
// job looks running with dead chunks. Cancel and undo make the same mistake:
// they trust a status they read earlier, then update by id.

import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';

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
  org = await createIsolatedOrg('migration-races');
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

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

describe('migration status races', () => {
  t('a cancel during enqueue is not overwritten by the start write', async () => {
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;

    const add = vi.spyOn(Queue.prototype, 'add').mockImplementation(async (name: unknown) => {
      const jobId = String(name).split('-chunk-')[0];
      // The cancel lands after the chunk is queued and before start returns.
      await prisma.migrationJob.update({
        where: { id: jobId },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      return { id: String(name) } as never;
    });

    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'name' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string }>();
      const row = await prisma.migrationJob.findUnique({ where: { id: body.id } });
      // The cancel won. A later by-id RUNNING write must not revive the job.
      expect(row?.status).toBe('CANCELLED');
    } finally {
      add.mockRestore();
    }
  });

  t('an enqueue failure does not leave the job RUNNING', async () => {
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('queue down'));
    const started = new Date();
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'name' },
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      const job = await prisma.migrationJob.findFirst({
        where: { orgId: org.orgId, createdAt: { gte: new Date(started.getTime() - 1000) } },
        orderBy: { createdAt: 'desc' },
      });
      expect(job?.status).toBe('FAILED');
    } finally {
      add.mockRestore();
    }
  });

  t('cancel does not trust a stale RUNNING read over a finished job', async () => {
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId,
        source: 'CSV',
        status: 'COMPLETE',
        totalRows: 1,
        processedRows: 1,
      },
    });
    const original = prisma.migrationJob.findFirst.bind(prisma.migrationJob);
    const read = vi.spyOn(prisma.migrationJob, 'findFirst').mockImplementation(async (args) => {
      const row = await original(args as never);
      if (row && row.id === job.id) return { ...row, status: 'RUNNING' };
      return row;
    });
    try {
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${job.id}/cancel`,
      });
      expect(res.statusCode).toBe(409);
      const row = await prisma.migrationJob.findUnique({ where: { id: job.id } });
      expect(row?.status).toBe('COMPLETE');
    } finally {
      read.mockRestore();
    }
  });

  t('undo does not trust a stale COMPLETE read over a job that is still running', async () => {
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt: new Date(),
      },
    });
    const original = prisma.migrationJob.findFirst.bind(prisma.migrationJob);
    const read = vi.spyOn(prisma.migrationJob, 'findFirst').mockImplementation(async (args) => {
      const row = await original(args as never);
      if (row && row.id === job.id) {
        return { ...row, status: 'COMPLETE', undoableUntil: new Date(Date.now() + 60_000) };
      }
      return row;
    });
    try {
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${job.id}/undo`,
      });
      expect(res.statusCode).toBe(409);
      const row = await prisma.migrationJob.findUnique({ where: { id: job.id } });
      expect(row?.status).toBe('RUNNING');
    } finally {
      read.mockRestore();
    }
  });
});
