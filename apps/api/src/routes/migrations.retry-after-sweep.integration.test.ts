// WHY: a leftover mark with no attempt id survives the stale sweep. The
// sweep fails the job, retry publishes a later attempt, and the old mark
// cancels that attempt. The user's cancel was already lost, and the retry
// must be allowed to finish.

import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import { expect, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { purgeAuditRows } from '../test-support/purge-audit-rows.js';
import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob } = makeMigrationsTestContext();

skipIfNoDb('a leftover pre-start mark does not cancel the retry after the stale sweep', async () => {
  const name = `Sweep Retry ${randomUUID().slice(0, 8)}`;
  const attemptId = randomUUID();
  const job = await createJob({ status: 'RUNNING' });
  const stale = new Date(Date.now() - 20 * 60_000);
  await prisma.migrationJob.update({
    where: { id: job.id },
    data: {
      totalRows: 1,
      processedRows: 0,
      errorRows: 0,
      updatedAt: stale,
      meta: {
        entityType: 'companies',
        dedupStrategy: 'skip',
        mappings: { Name: 'company.name' },
        attemptId,
        progressAt: stale.toISOString(),
      },
    },
  });
  await prisma.auditLog.create({
    data: {
      orgId: job.orgId,
      userId: job.userId,
      action: 'migration.cancel.requested',
      targetType: 'MigrationJob',
      targetId: job.id,
      diff: { attemptId: null },
    },
  });
  const { sweepStaleMigrations } = await import('../../../worker/src/queues/migration.js');
  await sweepStaleMigrations(new Date());
  const failed = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(failed.status).toBe('FAILED');
  await ctx.server.redis.set(
    `migration:${job.id}:companies:rows`,
    JSON.stringify([{ Name: name }]),
    'EX',
    3600,
  );
  const addBulk = vi.spyOn(Queue.prototype, 'addBulk').mockResolvedValue([{ id: 'chunk' }] as never);
  try {
    const retried = await ctx.server.inject({
      method: 'POST',
      url: `/api/v1/migrations/${job.id}/retry`,
    });
    expect(retried.statusCode).toBe(200);
  } finally {
    addBulk.mockRestore();
  }
  const running = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
  const nextAttempt = (running.meta as { attemptId?: string }).attemptId ?? '';
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
      attemptId: nextAttempt,
    },
    {
      readRows: async () => JSON.stringify([{ Name: name }]),
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    },
    { info: () => undefined, warn: () => undefined },
  );
  const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(stored.status).toBe('COMPLETE');
  expect(await prisma.company.count({ where: { orgId: job.orgId, name } })).toBe(1);
  await prisma.company.deleteMany({ where: { orgId: job.orgId, name } });
  await purgeAuditRows({
    where: {
      targetId: job.id,
      action: { in: ['migration.cancel.requested', 'migration.cancel.resolved', 'migration.retry', 'migration.cancel'] },
    },
  });
  await ctx.server.redis.del(`migration:${job.id}:companies:rows`);
});
