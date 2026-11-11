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

async function ageProgress(id: string): Promise<void> {
  const past = new Date(Date.now() - 16 * 60_000);
  await prisma.$executeRaw`
    UPDATE migration_jobs
    SET started_at = ${past}, updated_at = ${past}
    WHERE id = ${id}::uuid
  `;
}

/** A worker claim stamps progress, then the clock ages. The claim write must not refresh updatedAt. */
async function markWorkerClaim(id: string): Promise<void> {
  const past = new Date(Date.now() - 16 * 60_000).toISOString();
  await prisma.migrationJob.update({
    where: { id },
    data: { meta: { progressAt: past } },
  });
  await ageProgress(id);
}

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
      const body = res.json<{ id: string; status: string }>();
      expect(body.status).toBe('FAILED');
      add.mockResolvedValue({ id: 'chunk' } as never);
      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${body.id}/retry`,
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json<{ status: string }>().status).toBe('RUNNING');
      const audit = await prisma.auditLog.findFirst({
        where: { orgId: org.orgId, targetId: body.id, action: 'migration.retry' },
      });
      const diff = audit?.diff as { previousAttempt?: string | null; attemptId?: string } | null;
      expect(audit?.userId).toBe(userId);
      expect(diff?.previousAttempt).toEqual(expect.any(String));
      expect(diff?.attemptId).toEqual(expect.any(String));
      expect(diff?.attemptId).not.toBe(diff?.previousAttempt);
    } finally {
      add.mockRestore();
    }
  });

  t('a retry does not keep the previous attempt clock', async () => {
    // WHY: copying progressAt makes the wizard say the new attempt is stalled,
    // and the worker fails it after 15 minutes without a new claim.
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValueOnce(new Error('queue down'));
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
      const failed = await prisma.migrationJob.findUniqueOrThrow({ where: { id: body.id } });
      const past = new Date(Date.now() - 16 * 60_000).toISOString();
      await prisma.migrationJob.update({
        where: { id: body.id },
        data: { meta: { ...(failed.meta as object), progressAt: past } },
      });
      add.mockResolvedValue({ id: 'chunk' } as never);
      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${body.id}/retry`,
      });
      expect(retry.statusCode).toBe(200);
      const detail = await server.inject({
        method: 'GET',
        url: `/api/v1/migrations/${body.id}`,
      });
      expect(detail.json<{ status: string }>().status).toBe('RUNNING');
      expect(detail.json<{ stalled?: boolean }>().stalled).toBe(false);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: body.id } });
      expect((stored.meta as { progressAt?: unknown }).progressAt).toBeUndefined();
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

  t('list and detail agree, and a queued job is not stale', async () => {
    // WHY: stale is no progress since a worker claimed the chunk. A job that
    // was only marked running, and is still waiting in the queue, stays running.
    // The list and the detail poll must report that same derived flag.
    const backlog = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        errorRows: 0,
        startedAt: new Date(),
      },
    });
    await ageProgress(backlog.id);
    const detail = await server.inject({ method: 'GET', url: `/api/v1/migrations/${backlog.id}` });
    const list = await server.inject({ method: 'GET', url: '/api/v1/migrations' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ status: string; stalled?: boolean }>().stalled).toBe(false);
    const listed = list.json<{ items: Array<{ id: string; stalled?: boolean; status: string }> }>().items.find(
      (item) => item.id === backlog.id,
    );
    expect(listed?.status).toBe('RUNNING');
    expect(listed?.stalled).toBe(false);
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: backlog.id } });
    expect(stored.status).toBe('RUNNING');
  });

  t('GET reports a stale import without writing it', async () => {
    // WHY: a progress poll must not be the writer. A read-only or cross-site
    // GET used to fail the row, which is a state change from a safe method.
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        errorRows: 0,
        startedAt: new Date(),
      },
    });
    await markWorkerClaim(job.id);
    const before = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });

    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/migrations/${job.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; stalled?: boolean }>();
    expect(body.status).toBe('RUNNING');
    expect(body.stalled).toBe(true);
    const after = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe('RUNNING');
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  });

  t('a read-only user and a cross-site GET cannot fail a stale import', async () => {
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        errorRows: 0,
        startedAt: new Date(),
      },
    });
    await markWorkerClaim(job.id);
    const previousRole = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
    try {
      const reader = await server.inject({
        method: 'GET',
        url: `/api/v1/migrations/${job.id}`,
        headers: { 'x-bidstack-e2e-role': 'read-only' },
      });
      expect(reader.statusCode).toBe(200);
      expect(reader.json<{ status: string }>().status).toBe('RUNNING');

      const other = await createIsolatedOrg('migration-cross');
      const restore = useIsolatedOrgAuth(other.clerkOrg);
      try {
        const foreign = await server.inject({
          method: 'GET',
          url: `/api/v1/migrations/${job.id}`,
        });
        expect(foreign.statusCode).toBe(404);
      } finally {
        restore();
        await dropIsolatedOrg(other.orgId);
      }
    } finally {
      if (previousRole === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
      else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousRole;
    }
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe('RUNNING');
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
