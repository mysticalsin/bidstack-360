// WHY: a chunk holds migration_jobs FOR UPDATE for the whole import
// transaction. Cancel used to wait on that lock. The 120s transaction
// timeout does not cancel the blocked statement, so Cancel must answer
// while the lock is still held.

import { prisma } from '@bidstack/db';
import { expect } from 'vitest';

import { purgeAuditRows } from '../test-support/purge-audit-rows.js';
import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob } = makeMigrationsTestContext();

/** Longer than the handler's 2s lock wait. Far shorter than the chunk's 120s transaction. */
const CANCEL_RESPONSE_BOUND_MS = 5_000;

skipIfNoDb(
  'returns within CANCEL_RESPONSE_BOUND_MS while a chunk holds the job row lock',
  async () => {
    const job = await createJob({ status: 'RUNNING' });
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: { meta: { progressAt: new Date().toISOString() }, startedAt: new Date() },
    });
    let releaseLock!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let lockHeld!: () => void;
    const held = new Promise<void>((resolve) => {
      lockHeld = resolve;
    });

    const chunk = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM migration_jobs WHERE id = ${job.id}::uuid FOR UPDATE`;
        lockHeld();
        await released;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );

    await held;
    const pending = ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      const started = Date.now();
      const outcome = await Promise.race([
        pending.then((res) => ({
          kind: 'response' as const,
          res,
          ms: Date.now() - started,
        })),
        new Promise<{ kind: 'timeout'; ms: number }>((resolve) => {
          timeout = setTimeout(
            () => resolve({ kind: 'timeout', ms: Date.now() - started }),
            CANCEL_RESPONSE_BOUND_MS,
          );
        }),
      ]);

      expect(outcome.kind).toBe('response');
      if (outcome.kind !== 'response') return;
      expect(outcome.ms).toBeLessThanOrEqual(CANCEL_RESPONSE_BOUND_MS);
      expect(outcome.res.statusCode).toBe(200);
      const body = outcome.res.json<{ status: string; cancelRequested?: boolean }>();
      expect(body.status).toBe('RUNNING');
      expect(body.cancelRequested).toBe(true);
      const raw = JSON.stringify(body);
      expect(raw).not.toMatch(/55P03|PostgresError|lock_timeout|FOR UPDATE/);

      const mark = await prisma.auditLog.findFirst({
        where: { targetId: job.id, action: 'migration.cancel.requested' },
        select: { id: true },
      });
      expect(mark).not.toBeNull();
      const during = await prisma.migrationJob.findUnique({
        where: { id: job.id },
        select: { status: true },
      });
      expect(during?.status).toBe('RUNNING');
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseLock();
      await chunk;
      await pending;
      await purgeAuditRows({
        where: { targetId: job.id, action: 'migration.cancel.requested' },
      });
    }
  },
);

skipIfNoDb('lock_timeout does not leak onto the next pooled checkout', async () => {
  // WHY: set_config(..., true) is transaction-local. A false third argument
  // would leave 2s on the pooled session and the next request would wait less
  // than it should for unrelated locks.
  const job = await createJob({ status: 'RUNNING' });
  const res = await ctx.server.inject({
    method: 'DELETE',
    url: `/api/v1/migrations/${job.id}/cancel`,
  });
  expect(res.statusCode).toBe(200);
  const seen = new Set<string>();
  for (let i = 0; i < 16; i++) {
    const rows = await prisma.$queryRaw<Array<{ lock_timeout: string }>>`SHOW lock_timeout`;
    seen.add(rows[0]?.lock_timeout ?? '');
  }
  expect([...seen]).toEqual(['0']);
});

skipIfNoDb(
  'a row lock that is not a live chunk does not leave a mark that cancels the import',
  async () => {
    // WHY: Undo, a retry claim, the reaper, or a second Cancel can hold the
    // same row. A mark written for that wait would cancel a later chunk.
    const job = await createJob({ status: 'RUNNING' });
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
      const res = await ctx.server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${job.id}/cancel`,
      });
      expect(res.statusCode).toBe(409);
      const marks = await prisma.auditLog.count({
        where: { targetId: job.id, action: 'migration.cancel.requested' },
      });
      expect(marks).toBe(0);
    } finally {
      releaseLock();
      await holder;
      await purgeAuditRows({
        where: { targetId: job.id, action: 'migration.cancel.requested' },
      });
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
      },
      {
        readRows: async () => JSON.stringify([{ Name: 'Northwind Traders' }]),
        enqueueChunk: async () => undefined,
        enqueueIntel: async () => undefined,
        env: {},
      },
      { info: () => undefined, warn: () => undefined },
    );
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).not.toBe('CANCELLED');
    expect(await prisma.company.count({ where: { orgId: job.orgId, name: 'Northwind Traders' } })).toBe(1);
    await prisma.company.deleteMany({ where: { orgId: job.orgId, name: 'Northwind Traders' } });
  },
);
