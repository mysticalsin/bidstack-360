// WHY: retry wrote startedAt from the API clock. The cancel mark is stamped
// by the database. When the API clock is ahead, mark.at is before startedAt
// and the chunk treats the 202 as if it never happened.

import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import { afterEach, expect, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { purgeAuditRows } from '../test-support/purge-audit-rows.js';
import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob } = makeMigrationsTestContext();

const RealDate = Date;

afterEach(() => {
  vi.unstubAllGlobals();
});

skipIfNoDb(
  'a cancel accepted after retry still cancels when the API clock is ahead of the database',
  async () => {
    const companyName = `Skew Clock ${randomUUID().slice(0, 8)}`;
    const job = await createJob({ status: 'FAILED' });
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: {
        totalRows: 1,
        processedRows: 0,
        errorRows: 0,
        errorSummary: [],
        meta: {
          entityType: 'companies',
          dedupStrategy: 'skip',
          mappings: { Name: 'company.name' },
          attemptId: 'attempt-failed',
        },
      },
    });
    await ctx.server.redis.set(
      `migration:${job.id}:companies:rows`,
      JSON.stringify([{ Name: companyName }]),
      'EX',
      3600,
    );
    const addBulk = vi.spyOn(Queue.prototype, 'addBulk').mockResolvedValue([{ id: 'chunk' }] as never);

    class AheadDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        if (args.length === 0) super(RealDate.now() + 5_000);
        else super(...args);
      }

      static now(): number {
        return RealDate.now() + 5_000;
      }
    }
    vi.stubGlobal('Date', AheadDate);

    try {
      const retried = await ctx.server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${job.id}/retry`,
      });
      expect(retried.statusCode).toBe(200);
    } finally {
      vi.unstubAllGlobals();
      addBulk.mockRestore();
    }

    const running = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    const attemptId = (running.meta as { attemptId?: string }).attemptId;
    expect(typeof attemptId).toBe('string');

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
      const cancel = await ctx.server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${job.id}/cancel`,
      });
      expect(cancel.statusCode).toBe(202);
    } finally {
      releaseLock();
      await holder;
    }

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
    expect(stored.status).toBe('CANCELLED');
    expect(await prisma.company.count({ where: { orgId: job.orgId, name: companyName } })).toBe(0);
    await purgeAuditRows({
      where: { targetId: job.id, action: { in: ['migration.cancel.requested', 'migration.cancel', 'migration.retry'] } },
    });
    await ctx.server.redis.del(`migration:${job.id}:companies:rows`);
  },
);
