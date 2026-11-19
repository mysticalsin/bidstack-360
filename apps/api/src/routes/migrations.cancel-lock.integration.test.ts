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
      expect(outcome.res.statusCode).toBe(202);
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

skipIfNoDb('a second cancel while the chunk holds the row does not insert another mark', async () => {
  const job = await createJob({ status: 'RUNNING' });
  await prisma.migrationJob.update({
    where: { id: job.id },
    data: { meta: { progressAt: new Date().toISOString(), attemptId: 'attempt-live' }, startedAt: new Date() },
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
    const first = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    const second = await ctx.server.inject({
      method: 'DELETE',
      url: `/api/v1/migrations/${job.id}/cancel`,
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    const marks = await prisma.auditLog.count({
      where: { targetId: job.id, action: 'migration.cancel.requested', targetType: 'MigrationJob' },
    });
    expect(marks).toBe(1);
  } finally {
    releaseLock();
    await holder;
    await purgeAuditRows({
      where: { targetId: job.id, action: 'migration.cancel.requested' },
    });
  }
});

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
  'a busy row lock without progressAt still records cancel for this attempt',
  async () => {
    // WHY: start used to leave progressAt empty, so the same wait as a long
    // chunk was refused. A busy lock on a running attempt is cancel pending.
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
      expect(res.statusCode).toBe(202);
      const marks = await prisma.auditLog.count({
        where: { targetId: job.id, action: 'migration.cancel.requested' },
      });
      expect(marks).toBe(1);
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
    expect(stored.status).toBe('CANCELLED');
    expect(await prisma.company.count({ where: { orgId: job.orgId, name: 'Northwind Traders' } })).toBe(0);
    await purgeAuditRows({
      where: { targetId: job.id, action: { in: ['migration.cancel.requested', 'migration.cancel'] } },
    });
  },
);

skipIfNoDb(
  'a chunk lock older than 120s still accepts cancel and the next chunk cancels',
  async () => {
    // WHY: progressAt goes stale while the chunk still holds the row. Cancel
    // answered 409 and wrote no mark, so the import kept running.
    const job = await createJob({ status: 'RUNNING' });
    const attemptId = 'attempt-long';
    await prisma.$executeRaw`
      UPDATE migration_jobs
      SET started_at = NOW() - interval '10 minutes',
          meta = jsonb_build_object(
            'entityType', 'companies',
            'attemptId', ${attemptId}::text,
            'progressAt', to_char(
              (NOW() - interval '121 seconds') AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          )
      WHERE id = ${job.id}::uuid
    `;
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
      expect(res.statusCode).toBe(202);
      const body = res.json<{ status: string; cancelRequested?: boolean }>();
      expect(body.status).toBe('RUNNING');
      expect(body.cancelRequested).toBe(true);
      const marks = await prisma.auditLog.findMany({
        where: { targetId: job.id, action: 'migration.cancel.requested', targetType: 'MigrationJob' },
      });
      expect(marks).toHaveLength(1);
      expect(marks[0]?.diff).toMatchObject({ attemptId });
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
        readRows: async () => JSON.stringify([{ Name: 'Long Chunk Co' }]),
        enqueueChunk: async () => undefined,
        enqueueIntel: async () => undefined,
        env: {},
      },
      { info: () => undefined, warn: () => undefined },
    );
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe('CANCELLED');
    expect(await prisma.company.count({ where: { orgId: job.orgId, name: 'Long Chunk Co' } })).toBe(0);
    const audits = await prisma.auditLog.findMany({
      where: { targetId: job.id, action: 'migration.cancel' },
    });
    expect(audits).toHaveLength(1);
    await purgeAuditRows({
      where: { targetId: job.id, action: { in: ['migration.cancel.requested', 'migration.cancel'] } },
    });
  },
);
