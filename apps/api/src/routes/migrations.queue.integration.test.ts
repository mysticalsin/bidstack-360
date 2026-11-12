// buildServer() decorates server.redis. Start goes through that client and
// returns 2xx. Retry enqueues before the RUNNING claim, so a queue that
// cannot be opened leaves the job failed and returns a clear error.

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

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('migration-queue');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
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

describe('migration queue acquisition', () => {
  t('a retry whose queue cannot be opened keeps the failed job and says so', async () => {
    // WHY: the handler marked the job RUNNING and then getQueue() threw, so
    // the row was stranded running. Enqueue has to happen first. A throw
    // leaves the prior status and returns the reason.
    const user = await prisma.user.findFirstOrThrow({
      where: { orgId: org.orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId: user.id,
        source: 'CSV',
        status: 'FAILED',
        totalRows: 1,
        meta: { entityType: 'company', mappings: { name: 'company.name' }, dedupStrategy: 'update' },
      },
    });
    const statuses: string[] = [];
    const original = prisma.migrationJob.updateMany.bind(prisma.migrationJob);
    const updateMany = vi.spyOn(prisma.migrationJob, 'updateMany').mockImplementation((args) => {
      const status = (args.data as { status?: string } | undefined)?.status;
      if (status) statuses.push(status);
      return original(args);
    });
    const { redis } = await import('../redis.js');
    const duplicate = vi.spyOn(redis, 'duplicate').mockImplementation(() => {
      throw new Error('duplicate down');
    });
    try {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${job.id}/retry`,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ message: 'The import could not be queued. Try again.' });
      const again = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(again.status).toBe('FAILED');
      expect(statuses).not.toContain('RUNNING');
    } finally {
      duplicate.mockRestore();
      updateMany.mockRestore();
    }
  });

  t('a start that cannot store its rows does not leave a pending job', async () => {
    // WHY: the handler creates the job before redis.set. A throw there returns
    // 500 and leaves the row PENDING, which the wizard never shows.
    const { redis } = await import('../redis.js');
    const set = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('redis down'));
    // The audit log is insert-only outside tests. A cleanup that deletes the
    // start row throws, and the pending job is what remains.
    const removeAudit = vi.spyOn(prisma.auditLog, 'deleteMany').mockRejectedValue(
      new Error("AuditLog is insert-only: 'deleteMany' is not permitted."),
    );
    const before = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    const audits = await prisma.auditLog.count({
      where: { orgId: org.orgId, action: 'migration.start' },
    });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'company.name' },
        },
      });
      expect(res.statusCode).toBe(500);
    } finally {
      set.mockRestore();
      removeAudit.mockRestore();
    }
    const pending = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    expect(pending).toBe(before);
    // The start audit names a job that no longer exists.
    expect(
      await prisma.auditLog.count({ where: { orgId: org.orgId, action: 'migration.start' } }),
    ).toBe(audits);
  });

  t('repeated starts that cannot be queued leave no pending job', async () => {
    // WHY: each click created a PENDING job, stored its rows, and wrote an
    // audit, then returned 409 with no id. The next click added another.
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('queue down'));
    const removeAudit = vi.spyOn(prisma.auditLog, 'deleteMany').mockRejectedValue(
      new Error("AuditLog is insert-only: 'deleteMany' is not permitted."),
    );
    const beforeJobs = await prisma.migrationJob.count({ where: { orgId: org.orgId } });
    const beforePending = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    const beforeAudits = await prisma.auditLog.count({
      where: { orgId: org.orgId, action: 'migration.start' },
    });
    const beforeKeys = (await server.redis.keys('migration:*')).sort();
    try {
      for (const name of ['Acme', 'Beta']) {
        const res = await server.inject({
          method: 'POST',
          url: '/api/v1/migrations/start-csv',
          payload: {
            source: 'CSV',
            entityType: 'company',
            rows: [{ name }],
            mappings: { name: 'company.name' },
          },
        });
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({
          message: 'The import could not be queued. Try again.',
        });
      }
      expect(removeAudit).not.toHaveBeenCalled();
    } finally {
      add.mockRestore();
      removeAudit.mockRestore();
    }
    expect(await prisma.migrationJob.count({ where: { orgId: org.orgId } })).toBe(beforeJobs);
    expect(
      await prisma.migrationJob.count({ where: { orgId: org.orgId, status: 'PENDING' } }),
    ).toBe(beforePending);
    expect(
      await prisma.auditLog.count({ where: { orgId: org.orgId, action: 'migration.start' } }),
    ).toBe(beforeAudits);
    expect((await server.redis.keys('migration:*')).sort()).toEqual(beforeKeys);
  });

  t('starts a csv import on the process Redis client', async () => {
    // WHY: buildServer() has to hand the route the same Redis the process
    // already connected. A start that cannot see that client returns 500.
    expect(server.redis).toBeTruthy();
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/migrations/start-csv',
      payload: {
        source: 'CSV',
        entityType: 'company',
        rows: [{ name: 'Acme' }],
        mappings: { name: 'company.name' },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; status: string }>();
    expect(body.status).toBe('RUNNING');
    const job = await prisma.migrationJob.findUniqueOrThrow({ where: { id: body.id } });
    expect(job.status).toBe('RUNNING');
  });
});
