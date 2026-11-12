// WHY: the stale scan and a chunk can pass each other. The scan must claim
// RUNNING → FAILED only while the progress time it observed is still current.
// A chunk that just committed moves that clock and keeps the job running.

import { prisma } from '@bidstack/db';
import { migrationProgressAt } from '@bidstack/shared';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  claimStaleMigration,
  processMigrationChunk,
  sweepAbandonedPending,
  sweepStaleMigrations,
  type MigrationChunkDeps,
} from './migration.js';

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

async function runningJob(progressAt?: string) {
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_mig_stale_${ns}`, name: `stale ${ns}` },
  });
  const user = await prisma.user.create({
    data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'Stale' },
  });
  const job = await prisma.migrationJob.create({
    data: {
      orgId: org.id,
      userId: user.id,
      source: 'CSV',
      status: 'RUNNING',
      totalRows: 2,
      processedRows: 0,
      errorRows: 0,
      startedAt: new Date(),
      ...(progressAt ? { meta: { progressAt } } : {}),
    },
  });
  const past = new Date(Date.now() - 16 * 60_000);
  await prisma.$executeRaw`
    UPDATE migration_jobs SET updated_at = ${past}, started_at = ${past} WHERE id = ${job.id}::uuid
  `;
  return { org, job };
}

async function pendingJob(ageMs: number, entityType = 'company') {
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_mig_pending_${ns}`, name: `pending ${ns}` },
  });
  const user = await prisma.user.create({
    data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'Pending' },
  });
  const job = await prisma.migrationJob.create({
    data: {
      orgId: org.id,
      userId: user.id,
      source: 'CSV',
      status: 'PENDING',
      totalRows: 1,
      meta: { entityType },
    },
  });
  const past = new Date(Date.now() - ageMs);
  await prisma.$executeRaw`
    UPDATE migration_jobs SET created_at = ${past}, updated_at = ${past} WHERE id = ${job.id}::uuid
  `;
  return { org, user, job };
}

describe('migration stale scan', () => {
  t('a chunk that just reported progress beats the stale claim', async () => {
    const { org, job } = await runningJob();
    const observed = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: { processedRows: 1 },
    });
    const claimed = await claimStaleMigration(job.id, observed.updatedAt);
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(claimed).toBe(false);
    expect(stored.status).toBe('RUNNING');
    expect(stored.processedRows).toBe(1);
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('a job still waiting in the queue is not failed', async () => {
    // WHY: stale is no progress since a worker claimed the chunk. Time spent
    // queued, with no progress clock, is a healthy backlog.
    const { org, job } = await runningJob();
    const claimed = await sweepStaleMigrations(new Date());
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(claimed).toBe(0);
    expect(stored.status).toBe('RUNNING');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('a running import with no progress is failed with reason stale', async () => {
    const past = new Date(Date.now() - 16 * 60_000).toISOString();
    const { org, job } = await runningJob(past);
    const claimed = await sweepStaleMigrations(new Date());
    expect(claimed).toBe(1);
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe('FAILED');
    const summary = stored.errorSummary as Array<{ message?: string }>;
    expect(summary[0]?.message).toBe('stale');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('a real claim is swept after the worker dies', async () => {
    // WHY: the claim SQL is the clock the sweep compares. Prisma reads
    // updated_at back at millisecond resolution. A microsecond NOW() never
    // equals that value, so the compare-and-set misses and the import stays
    // RUNNING after the worker is gone.
    const { org, job } = await runningJob();
    const deps: MigrationChunkDeps = {
      readRows: async () => {
        throw new Error('worker died');
      },
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    };
    await expect(
      processMigrationChunk(
        {
          migrationJobId: job.id,
          orgId: org.id,
          userId: job.userId,
          source: 'CSV',
          entityType: 'companies',
          chunkOffset: 0,
          chunkSize: 100,
          totalRows: 2,
          redisKey: 'rows',
          mappings: { Name: 'company.name' },
          dedupStrategy: 'skip',
        },
        deps,
        { info: () => undefined, warn: () => undefined },
      ),
    ).rejects.toThrow(/worker died/);
    const claimed = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(migrationProgressAt(claimed.meta)).not.toBeNull();
    // Do not rewrite updated_at here. A JS date would hide the microsecond mismatch.
    await sweepStaleMigrations(new Date(Date.now() + 16 * 60_000));
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe('FAILED');
    const summary = stored.errorSummary as Array<{ message?: string }>;
    expect(summary[0]?.message).toBe('stale');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('an old pending start that never queued is removed', async () => {
    // WHY: a crash after migration.start_failed, or before the chunks were
    // queued, leaves a PENDING job the wizard never received. The sweep has
    // to remove it. An old job that still has a queue entry is marked failed
    // so it does not keep the slot. A young one stays.
    const abandoned = await pendingJob(16 * 60_000);
    await prisma.auditLog.create({
      data: {
        orgId: abandoned.org.id,
        userId: abandoned.user.id,
        action: 'migration.start_failed',
        targetType: 'MigrationJob',
        targetId: abandoned.job.id,
        diff: { reason: 'queue' },
      },
    });
    const unqueued = await pendingJob(16 * 60_000);
    const queued = await pendingJob(16 * 60_000);
    const young = await pendingJob(60_000);
    await prisma.auditLog.create({
      data: {
        orgId: young.org.id,
        userId: young.user.id,
        action: 'migration.start_failed',
        targetType: 'MigrationJob',
        targetId: young.job.id,
        diff: { reason: 'rows' },
      },
    });
    const deleted: string[] = [];
    const reaped = await sweepAbandonedPending(new Date(), {
      hasQueueEntry: async (id) => id === queued.job.id,
      deleteRows: async (key) => {
        deleted.push(key);
      },
    });
    expect(reaped).toBe(3);
    expect(await prisma.migrationJob.findUnique({ where: { id: abandoned.job.id } })).toBeNull();
    expect(await prisma.migrationJob.findUnique({ where: { id: unqueued.job.id } })).toBeNull();
    expect((await prisma.migrationJob.findUnique({ where: { id: queued.job.id } }))?.status).toBe(
      'FAILED',
    );
    expect((await prisma.migrationJob.findUnique({ where: { id: young.job.id } }))?.status).toBe(
      'PENDING',
    );
    expect(deleted.sort()).toEqual(
      [
        `migration:${abandoned.job.id}:company:rows`,
        `migration:${unqueued.job.id}:company:rows`,
      ].sort(),
    );
    const audit = await prisma.auditLog.findFirst({
      where: { orgId: abandoned.org.id, targetId: abandoned.job.id, action: 'migration.start_failed' },
    });
    expect(audit).toBeTruthy();
    const traces = await prisma.auditLog.findMany({
      where: {
        action: 'migration.reaped',
        targetId: { in: [abandoned.job.id, unqueued.job.id] },
      },
    });
    expect(traces.map((row) => row.targetId).sort()).toEqual(
      [abandoned.job.id, unqueued.job.id].sort(),
    );
    expect(traces.find((row) => row.targetId === abandoned.job.id)?.diff).toMatchObject({
      reason: 'start_failed',
    });
    expect(traces.find((row) => row.targetId === unqueued.job.id)?.diff).toMatchObject({
      reason: 'no_queue_entry',
    });
    for (const row of [abandoned, unqueued, queued, young]) {
      await prisma.org.delete({ where: { id: row.org.id } }).catch(() => undefined);
    }
  });

  t('an old pending import that already has queued chunks releases the slot', async () => {
    // WHY: the sweep used to leave a PENDING row alone when a chunk was
    // queued. That row holds the same-import slot until someone deletes it.
    const queued = await pendingJob(16 * 60_000);
    const released = await sweepAbandonedPending(new Date(), {
      hasQueueEntry: async () => true,
    });
    expect(released).toBe(1);
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: queued.job.id } });
    expect(stored.status).toBe('FAILED');
    await prisma.org.delete({ where: { id: queued.org.id } }).catch(() => undefined);
  });

  t('a delete that does not land does not record a reap', async () => {
    // WHY: the reap audit used to commit before the delete. A delete that
    // removes nothing, or is rejected, left a "reaped" row, and the next
    // scan wrote another one for the same still-pending job.
    const abandoned = await pendingJob(16 * 60_000);
    await prisma.auditLog.create({
      data: {
        orgId: abandoned.org.id,
        userId: abandoned.user.id,
        action: 'migration.start_failed',
        targetType: 'MigrationJob',
        targetId: abandoned.job.id,
        diff: { reason: 'queue' },
      },
    });
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION block_reap_delete() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        IF OLD.id = '${abandoned.job.id}'::uuid THEN
          RAISE EXCEPTION 'delete blocked';
        END IF;
        RETURN OLD;
      END;
      $fn$;
    `);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER block_reap BEFORE DELETE ON migration_jobs FOR EACH ROW EXECUTE FUNCTION block_reap_delete()`,
    );
    try {
      await expect(sweepAbandonedPending(new Date())).resolves.toBe(0);
      await expect(sweepAbandonedPending(new Date())).resolves.toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { targetId: abandoned.job.id, action: 'migration.reaped' },
        }),
      ).toBe(0);
      expect(
        (await prisma.migrationJob.findUnique({ where: { id: abandoned.job.id } }))?.status,
      ).toBe('PENDING');
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS block_reap ON migration_jobs`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS block_reap_delete()`);
      await prisma.org.delete({ where: { id: abandoned.org.id } }).catch(() => undefined);
    }
  });

  t('a delete that raises still reaps the next abandoned job', async () => {
    // WHY: the sweep used to throw out of the loop. One rejected delete
    // left every later abandoned import pending until the next process.
    const first = await pendingJob(16 * 60_000);
    const second = await pendingJob(16 * 60_000);
    for (const row of [first, second]) {
      await prisma.auditLog.create({
        data: {
          orgId: row.org.id,
          userId: row.user.id,
          action: 'migration.start_failed',
          targetType: 'MigrationJob',
          targetId: row.job.id,
          diff: { reason: 'queue' },
        },
      });
    }
    await prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS reap_block_seq`);
    await prisma.$executeRawUnsafe(`ALTER SEQUENCE reap_block_seq RESTART WITH 1`);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION block_first_reap() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        IF nextval('reap_block_seq') = 1 THEN
          RAISE EXCEPTION 'delete blocked';
        END IF;
        RETURN OLD;
      END;
      $fn$;
    `);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER block_first_reap BEFORE DELETE ON migration_jobs FOR EACH ROW EXECUTE FUNCTION block_first_reap()`,
    );
    try {
      await expect(sweepAbandonedPending(new Date())).resolves.toBe(1);
      const still = [];
      for (const row of [first, second]) {
        const stored = await prisma.migrationJob.findUnique({ where: { id: row.job.id } });
        if (stored) still.push(row);
      }
      expect(still).toHaveLength(1);
      expect(
        await prisma.auditLog.count({
          where: { targetId: still[0]!.job.id, action: 'migration.reaped' },
        }),
      ).toBe(0);
      const gone = first.job.id === still[0]!.job.id ? second : first;
      expect(
        await prisma.auditLog.count({
          where: { targetId: gone.job.id, action: 'migration.reaped' },
        }),
      ).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS block_first_reap ON migration_jobs`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS block_first_reap()`);
      await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS reap_block_seq`);
      await prisma.org.delete({ where: { id: first.org.id } }).catch(() => undefined);
      await prisma.org.delete({ where: { id: second.org.id } }).catch(() => undefined);
    }
  });
});
