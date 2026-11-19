// WHY: Cancel records migration.cancel.requested when it cannot take the
// job-row lock. The chunk has to see that mark and write nothing, or the
// import commits after the user has already been told cancel was accepted.

import { prisma } from '@bidstack/db';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { applyMarkedCancel, processMigrationChunk, type MigrationChunkDeps } from './migration.js';

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

  t('a newer mark for the previous attempt does not cancel the current attempt', async () => {
    // WHY: dropping the attempt filter must go red. The mark is newer than
    // startedAt, so only the attempt id keeps this chunk alive.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_newmark_${ns}`, name: `newmark ${ns}` },
    });
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `user_${ns}`,
        email: `${ns}@test.local`,
        name: 'Newmark',
      },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt: new Date(Date.now() - 60_000),
        meta: { entityType: 'companies', attemptId: 'attempt-2' },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: user.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
        diff: { attemptId: 'attempt-1' },
      },
    });
    const deps: MigrationChunkDeps = {
      readRows: async () => JSON.stringify([{ Name: 'Newer Mark Co' }]),
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

  t('a cancel mark older than the chunk lock window does not cancel the attempt', async () => {
    // WHY: a mark has to expire. Otherwise a lock that was not a chunk leaves
    // a row that cancels the import long after the waiter is gone.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_expire_${ns}`, name: `expire ${ns}` },
    });
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `user_${ns}`,
        email: `${ns}@test.local`,
        name: 'Expire',
      },
    });
    const startedAt = new Date(Date.now() - 10 * 60_000);
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt,
        meta: { entityType: 'companies', attemptId: 'attempt-live' },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: user.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
        at: new Date(Date.now() - 4 * 60_000),
        diff: { attemptId: 'attempt-live' },
      },
    });
    const deps: MigrationChunkDeps = {
      readRows: async () => JSON.stringify([{ Name: 'Expired Mark Co' }]),
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
          attemptId: 'attempt-live',
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

  t('a cancel mark written after the row loop rolls the inserts back', async () => {
    // WHY: the second check is the one that sees a cancel landing while the
    // chunk holds the row. Removing it commits the companies.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_late_${ns}`, name: `late ${ns}` },
    });
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `user_${ns}`,
        email: `${ns}@test.local`,
        name: 'Late',
      },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt: new Date(Date.now() - 1_000),
        meta: { entityType: 'companies', attemptId: 'attempt-live' },
      },
    });
    const deps: MigrationChunkDeps = {
      readRows: async () => JSON.stringify([{ Name: 'Late Cancel Co' }]),
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
      afterRows: async () => {
        await prisma.auditLog.create({
          data: {
            orgId: org.id,
            userId: user.id,
            action: 'migration.cancel.requested',
            targetType: 'MigrationJob',
            targetId: job.id,
            diff: { attemptId: 'attempt-live' },
          },
        });
      },
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
          attemptId: 'attempt-live',
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

  t('a cancel mark for a different target type does not stop the chunk', async () => {
    // WHY: targetId is a string. Another audit row with the same id and the
    // cancel action must not be treated as a migration cancel.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_type_${ns}`, name: `type ${ns}` },
    });
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `user_${ns}`,
        email: `${ns}@test.local`,
        name: 'Type',
      },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt: new Date(Date.now() - 1_000),
        meta: { entityType: 'companies' },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: user.id,
        action: 'migration.cancel.requested',
        targetType: 'Company',
        targetId: job.id,
      },
    });
    const deps: MigrationChunkDeps = {
      readRows: async () => JSON.stringify([{ Name: 'Other Target Co' }]),
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
      expect(await prisma.company.count({ where: { orgId: org.id, deletedAt: null } })).toBe(1);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).not.toBe('CANCELLED');
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a marked cancel audits the canceller, not the importer', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_actor_${ns}`, name: `actor ${ns}` },
    });
    const importer = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `imp_${ns}`,
        email: `imp-${ns}@test.local`,
        name: 'Importer',
      },
    });
    const canceller = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `can_${ns}`,
        email: `can-${ns}@test.local`,
        name: 'Canceller',
      },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt: new Date(Date.now() - 1_000),
        meta: { entityType: 'companies' },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: canceller.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
      },
    });
    const deps: MigrationChunkDeps = {
      readRows: async () => JSON.stringify([{ Name: 'Actor Co' }]),
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
        },
        deps,
        log,
      );
      const audit = await prisma.auditLog.findFirst({
        where: { orgId: org.id, targetId: job.id, action: 'migration.cancel' },
      });
      expect(audit?.userId).toBe(canceller.id);
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a lost cancel keeps COMPLETE and audits the canceller', async () => {
    // WHY: the compare-and-set can lose to a chunk that already finished.
    // Dropping that on the floor hides the click, and the audit must name
    // the person who cancelled, not the person who started the import.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_lost_${ns}`, name: `lost ${ns}` },
    });
    const importer = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `imp_${ns}`,
        email: `imp-${ns}@test.local`,
        name: 'Importer',
      },
    });
    const canceller = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `can_${ns}`,
        email: `can-${ns}@test.local`,
        name: 'Canceller',
      },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'COMPLETE',
        totalRows: 1,
        processedRows: 1,
        startedAt: new Date(Date.now() - 60_000),
        completedAt: new Date(),
        meta: { entityType: 'companies', attemptId: 'attempt-done' },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: canceller.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
        diff: { attemptId: 'attempt-done' },
      },
    });
    const info = vi.fn();
    try {
      await applyMarkedCancel(org.id, job.id, { info });
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe('COMPLETE');
      const lost = await prisma.auditLog.findFirst({
        where: { orgId: org.id, targetId: job.id, action: 'migration.cancel.lost' },
      });
      expect(lost?.userId).toBe(canceller.id);
      expect(info).toHaveBeenCalledWith(
        { migrationJobId: job.id, status: 'COMPLETE' },
        'migration cancel lost',
      );
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a lost cancel keeps FAILED', async () => {
    // WHY: the compare-and-set is limited to PENDING and RUNNING. Without that
    // filter a mark rewrites a failed job to CANCELLED.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_failed_${ns}`, name: `failed ${ns}` },
    });
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        clerkUser: `user_${ns}`,
        email: `${ns}@test.local`,
        name: 'Failed',
      },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'FAILED',
        totalRows: 1,
        processedRows: 0,
        startedAt: new Date(Date.now() - 60_000),
        completedAt: new Date(),
        meta: { entityType: 'companies', attemptId: 'attempt-failed' },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: user.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
        diff: { attemptId: 'attempt-failed' },
      },
    });
    try {
      await applyMarkedCancel(org.id, job.id, { info: () => undefined });
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe('FAILED');
      const cancel = await prisma.auditLog.findFirst({
        where: { orgId: org.id, targetId: job.id, action: 'migration.cancel' },
      });
      expect(cancel).toBeNull();
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });
});
