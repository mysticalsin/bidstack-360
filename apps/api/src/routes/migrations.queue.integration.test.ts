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
    // WHY: the handler creates the job before redis.set. A throw there used to
    // return 500 after the cleanup had already removed the job. The queue-down
    // path returns 409, and this one has to as well.
    const { redis } = await import('../redis.js');
    const set = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('redis down'));
    const before = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    const audits = await prisma.auditLog.count({
      where: { orgId: org.orgId, action: 'migration.start' },
    });
    const failed = await prisma.auditLog.count({
      where: { orgId: org.orgId, action: 'migration.start_failed' },
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
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        message: 'The import could not be queued. Try again.',
      });
    } finally {
      set.mockRestore();
    }
    const pending = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    expect(pending).toBe(before);
    expect(
      await prisma.auditLog.count({ where: { orgId: org.orgId, action: 'migration.start' } }),
    ).toBe(audits);
    expect(
      await prisma.auditLog.count({ where: { orgId: org.orgId, action: 'migration.start_failed' } }),
    ).toBe(failed + 1);
  });

  t('repeated starts that cannot be queued leave no pending job', async () => {
    // WHY: each click created a PENDING job, stored its rows, and wrote an
    // audit, then returned 409 with no id. The next click added another.
    // The failure is an extra audit row. The log is insert-only, so cleanup
    // must not delete one.
    await expect(prisma.auditLog.deleteMany({ where: { orgId: org.orgId } })).rejects.toThrow(
      /insert-only/,
    );
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('queue down'));
    const beforeJobs = await prisma.migrationJob.count({ where: { orgId: org.orgId } });
    const beforePending = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    const beforeAudits = await prisma.auditLog.count({
      where: { orgId: org.orgId, action: 'migration.start' },
    });
    const beforeFailed = await prisma.auditLog.count({
      where: { orgId: org.orgId, action: 'migration.start_failed' },
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
    } finally {
      add.mockRestore();
    }
    expect(await prisma.migrationJob.count({ where: { orgId: org.orgId } })).toBe(beforeJobs);
    expect(
      await prisma.migrationJob.count({ where: { orgId: org.orgId, status: 'PENDING' } }),
    ).toBe(beforePending);
    expect(
      await prisma.auditLog.count({ where: { orgId: org.orgId, action: 'migration.start' } }),
    ).toBe(beforeAudits);
    expect(
      await prisma.auditLog.count({ where: { orgId: org.orgId, action: 'migration.start_failed' } }),
    ).toBe(beforeFailed + 2);
    expect((await server.redis.keys('migration:*')).sort()).toEqual(beforeKeys);
  });

  t('a failed start keeps the job and its rows when the failure audit cannot be written', async () => {
    // WHY: the failure row is written first. If that insert throws, deleting
    // the Redis key would leave a PENDING job whose rows are already gone.
    const create = vi.spyOn(prisma.auditLog, 'create').mockRejectedValue(new Error('audit down'));
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('queue down'));
    const beforePending = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    const beforeKeys = (await server.redis.keys('migration:*')).sort();
    try {
      await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'company.name' },
        },
      });
    } finally {
      create.mockRestore();
      add.mockRestore();
    }
    expect(
      await prisma.migrationJob.count({ where: { orgId: org.orgId, status: 'PENDING' } }),
    ).toBe(beforePending + 1);
    expect((await server.redis.keys('migration:*')).length).toBe(beforeKeys.length + 1);
  });

  t('a failed start does not drop the rows when the job cannot be removed', async () => {
    // WHY: the Redis key is last. A throw from the job delete must leave the
    // key in place, and the failure audit must already be stored.
    const original = prisma.migrationJob.deleteMany.bind(prisma.migrationJob);
    const removeJob = vi.spyOn(prisma.migrationJob, 'deleteMany').mockImplementation((args) => {
      const where = args?.where as { id?: string; status?: string } | undefined;
      if (where?.status === 'PENDING' && where.id) throw new Error('job delete down');
      return original(args);
    });
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('queue down'));
    const beforePending = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    const beforeFailed = await prisma.auditLog.count({
      where: { orgId: org.orgId, action: 'migration.start_failed' },
    });
    const beforeKeys = (await server.redis.keys('migration:*')).sort();
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
      removeJob.mockRestore();
      add.mockRestore();
    }
    expect(
      await prisma.migrationJob.count({ where: { orgId: org.orgId, status: 'PENDING' } }),
    ).toBe(beforePending + 1);
    expect(
      await prisma.auditLog.count({ where: { orgId: org.orgId, action: 'migration.start_failed' } }),
    ).toBe(beforeFailed + 1);
    expect((await server.redis.keys('migration:*')).length).toBe(beforeKeys.length + 1);
  });

  t('a later chunk that fails to queue removes the chunks already accepted', async () => {
    // WHY: chunk 0 is already in BullMQ when chunk 1 throws. Deleting the
    // job row leaves that chunk to run against a job that no longer exists.
    const rows = Array.from({ length: 101 }, (_, index) => ({ name: `Acme ${index}` }));
    let added = 0;
    const add = vi.spyOn(Queue.prototype, 'add').mockImplementation(async () => {
      added += 1;
      if (added > 1) throw new Error('queue down');
      return { id: 'chunk-0' } as never;
    });
    const removed: string[] = [];
    const remove = vi.spyOn(Queue.prototype, 'remove').mockImplementation(async (id: string) => {
      removed.push(id);
      return 1;
    });
    const beforePending = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows,
          mappings: { name: 'company.name' },
        },
      });
      expect(res.statusCode).toBe(409);
      expect(added).toBe(2);
      expect(removed).toHaveLength(1);
      expect(removed[0]).toMatch(/-company-chunk-0$/);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
    expect(
      await prisma.migrationJob.count({ where: { orgId: org.orgId, status: 'PENDING' } }),
    ).toBe(beforePending);
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
