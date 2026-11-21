// WHY: Cancel can time out while start still holds the row, before an
// attemptId exists. The mark is stored with a null attempt. Start then
// publishes a new attemptId. The worker used to ignore that mark, return
// the job COMPLETE, and write no migration.cancel.lost.

import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { purgeAuditRows } from '../test-support/purge-audit-rows.js';
import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, createJob } = makeMigrationsTestContext();

it(
  'a cancel that waits out start does not let the new attempt complete',
  async () => {
    if (!ctx.dbReachable || !ctx.seedOrgId) {
      throw new Error('[skip] cancel during start — DATABASE_URL not reachable');
    }
    const companyName = `Start Lock ${randomUUID().slice(0, 8)}`;
    const job = await createJob({ status: 'PENDING' });
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: {
        totalRows: 1,
        processedRows: 0,
        errorRows: 0,
        startedAt: null,
        meta: {
          entityType: 'companies',
          dedupStrategy: 'skip',
          mappings: { Name: 'company.name' },
        },
      },
    });

    let releaseLock!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let lockHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      lockHeld = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM migration_jobs WHERE id = ${job.id}::uuid FOR UPDATE`;
        lockHeld();
        await released;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
    await held;

    try {
      const started = Date.now();
      const cancel = await ctx.server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${job.id}/cancel`,
      });
      const cancelMs = Date.now() - started;
      expect(cancel.statusCode).toBe(202);
      expect(cancel.json<{ cancelRequested?: boolean }>().cancelRequested).toBe(true);
      expect(cancelMs).toBeGreaterThanOrEqual(2_000);
      expect(cancelMs).toBeLessThan(5_000);
      const mark = await prisma.auditLog.findFirst({
        where: {
          targetId: job.id,
          action: 'migration.cancel.requested',
          targetType: 'MigrationJob',
        },
      });
      expect(mark).not.toBeNull();
      expect((mark?.diff as { attemptId?: string | null } | null)?.attemptId ?? null).toBeNull();
    } finally {
      releaseLock();
      await holder;
    }

    const attemptId = randomUUID();
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        meta: {
          entityType: 'companies',
          dedupStrategy: 'skip',
          mappings: { Name: 'company.name' },
          attemptId,
        },
      },
    });
    await prisma.$executeRaw`
      UPDATE migration_jobs SET started_at = NOW() WHERE id = ${job.id}::uuid
    `;
    const claimed = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect((claimed.meta as { attemptId?: string }).attemptId).toBe(attemptId);

    const { processMigrationChunk } = await import('../../../worker/src/queues/migration.js');
    await processMigrationChunk(
      {
        migrationJobId: job.id,
        orgId: job.orgId,
        userId: job.userId,
        source: 'CSV',
        entityType: 'companies',
        chunkOffset: 0,
        chunkSize: 100,
        totalRows: 1,
        redisKey: 'rows',
        mappings: { Name: 'company.name' },
        dedupStrategy: 'skip',
        attemptId,
      },
      {
        readRows: async () => JSON.stringify([{ Name: companyName }]),
        enqueueChunk: async () => undefined,
        enqueueIntel: async () => undefined,
        env: {},
      },
      { info: () => undefined, warn: () => undefined },
    );

    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    const applied = await prisma.auditLog.count({
      where: { targetId: job.id, action: 'migration.cancel' },
    });
    const lost = await prisma.auditLog.count({
      where: { targetId: job.id, action: 'migration.cancel.lost' },
    });
    expect({ status: stored.status, cancel: applied, lost }).toEqual({
      status: 'CANCELLED',
      cancel: 1,
      lost: 0,
    });
    expect(await prisma.company.count({ where: { orgId: job.orgId, name: companyName } })).toBe(0);
    await purgeAuditRows({
      where: {
        targetId: job.id,
        action: { in: ['migration.cancel.requested', 'migration.cancel', 'migration.cancel.lost'] },
      },
    });
  },
  30_000,
);
