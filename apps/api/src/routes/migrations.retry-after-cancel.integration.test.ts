// WHY: a cancel mark with no attempt id binds to every later attempt. A
// retry after that cancel is cancelled at 0 rows. The retry is a new
// intent and has to run.
//
// I-9: that binding is the null-attempt branch in the worker
// (migration.ts cancelWasRequested and maybeComplete, the OR that matches
// a mark with no attempt id when the attempt started at or after the mark).
// The retry claim resolves those marks first, so this later attempt is not
// the start the mark was for.

import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import { expect, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { purgeAuditRows } from '../test-support/purge-audit-rows.js';
import { makeMigrationsTestContext } from './migrations.test-helpers.js';

const { ctx, skipIfNoDb, createJob } = makeMigrationsTestContext();

async function retryable(name: string) {
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
      },
    },
  });
  await ctx.server.redis.set(
    `migration:${job.id}:companies:rows`,
    JSON.stringify([{ Name: name }]),
    'EX',
    3600,
  );
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
  return job;
}

async function runChunk(job: { id: string; orgId: string; userId: string }, name: string, attemptId: string) {
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
      readRows: async () => JSON.stringify([{ Name: name }]),
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    },
    { info: () => undefined, warn: () => undefined },
  );
}

skipIfNoDb('a retry after a pending cancel runs to completion', async () => {
  const name = `Retry After ${randomUUID().slice(0, 8)}`;
  const job = await retryable(name);
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
  const attemptId = (running.meta as { attemptId?: string }).attemptId ?? '';
  await runChunk(job, name, attemptId);
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

skipIfNoDb('a pending cancel mark is resolved when the retry claim takes the row', async () => {
  // WHY: the mark is committed before the claim locks the row. The claim
  // resolves it, then publishes the attempt. The chunk completes.
  const name = `Retry Race ${randomUUID().slice(0, 8)}`;
  const job = await retryable(name);
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
  const addBulk = vi.spyOn(Queue.prototype, 'addBulk').mockResolvedValue([{ id: 'chunk' }] as never);
  const retrying = ctx.server.inject({
    method: 'POST',
    url: `/api/v1/migrations/${job.id}/retry`,
  });
  try {
    const started = Date.now();
    while (Date.now() - started < 3_000) {
      const waiters = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%migration_jobs%'
      `;
      if ((waiters[0]?.n ?? 0) > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    releaseLock();
    await holder;
    addBulk.mockRestore();
  }
  const retried = await retrying;
  expect(retried.statusCode, retried.body).toBe(200);
  const running = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
  const attemptId = (running.meta as { attemptId?: string }).attemptId ?? '';
  await runChunk(job, name, attemptId);
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
