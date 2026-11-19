// WHY: Cancel records migration.cancel.requested when it cannot take the
// job-row lock. The chunk has to see that mark and write nothing, or the
// import commits after the user has already been told cancel was accepted.

import { prisma } from '@bidstack/db';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { processMigrationChunk, type MigrationChunkDeps } from './migration.js';

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}, 30_000);

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

const log = { info: () => undefined, warn: () => undefined };

describe('migration cancel request', () => {
  t('a cancel request stops the chunk from writing rows and cancels the job', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_cancel_${ns}`, name: `cancel ${ns}` },
    });
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `user_${ns}`,
        email: `${ns}@test.local`,
        name: 'Cancel',
      },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt: new Date(),
        meta: { entityType: 'companies' },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: user.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
      },
    });

    const deps: MigrationChunkDeps = {
      readRows: async () => JSON.stringify([{ Name: 'Northwind Traders' }]),
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    };
    try {
      await processMigrationChunk(
        {
          migrationJobId: job.id,
          orgId: org.id,
          userId: user.id,
          source: 'CSV',
          entityType: 'companies',
          chunkOffset: 0,
          chunkSize: 100,
          totalRows: 1,
          redisKey: 'rows',
          mappings: { Name: 'company.name' },
          dedupStrategy: 'skip',
        },
        deps,
        log,
      );

      expect(await prisma.company.count({ where: { orgId: org.id, deletedAt: null } })).toBe(0);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe('CANCELLED');
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a cancel mark for attempt 1 does not cancel attempt 2 after retry', async () => {
    // WHY: retry keeps the job id and only replaces meta.attemptId. A mark
    // from the cancelled attempt must not abort the rows of the next one.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_retry_${ns}`, name: `retry ${ns}` },
    });
    const importer = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `user_${ns}`,
        email: `${ns}@test.local`,
        name: 'Importer',
      },
    });
    const attempt1Started = new Date(Date.now() - 60_000);
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'FAILED',
        totalRows: 1,
        startedAt: attempt1Started,
        completedAt: attempt1Started,
        meta: { entityType: 'companies', attemptId: 'attempt-1' },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
        diff: { attemptId: 'attempt-1' },
      },
    });
    const attempt2Started = new Date();
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        startedAt: attempt2Started,
        completedAt: null,
        meta: { entityType: 'companies', attemptId: 'attempt-2' },
      },
    });
    const deps: MigrationChunkDeps = {
      readRows: async () => JSON.stringify([{ Name: 'Northwind Traders' }]),
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    };
    try {
      await processMigrationChunk(
        {
          migrationJobId: job.id,
          orgId: org.id,
          userId: importer.id,
          source: 'CSV',
          entityType: 'companies',
          chunkOffset: 0,
          chunkSize: 100,
          totalRows: 1,
          redisKey: 'rows',
          mappings: { Name: 'company.name' },
          dedupStrategy: 'skip',
          attemptId: 'attempt-2',
        },
        deps,
        log,
      );
      expect(await prisma.company.count({ where: { orgId: org.id, deletedAt: null } })).toBe(1);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).not.toBe('CANCELLED');
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });
});
