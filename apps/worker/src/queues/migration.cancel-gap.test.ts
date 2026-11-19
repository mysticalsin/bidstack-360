// WHY: the last in-transaction read can miss a cancel mark that the
// bookkeeping UPDATE itself inserts. Completion must not turn that into
// COMPLETE, a partial chunk must not stay RUNNING, and a later attempt must
// not inherit the mark. The stale sweep has to cancel a dead worker instead
// of failing the job and offering Retry.

import { prisma } from '@bidstack/db';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { processMigrationChunk, sweepStaleMigrations, type MigrationChunkDeps } from './migration.js';

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deps(rows: string): MigrationChunkDeps {
  return {
    readRows: async () => rows,
    enqueueChunk: async () => undefined,
    enqueueIntel: async () => undefined,
    env: {},
  };
}

async function orgWithUsers(label: string) {
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_mig_${label}_${ns}`, name: `${label} ${ns}` },
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
  return { ns, org, importer, canceller };
}

async function installBookkeepingTrigger(ns: string, jobId: string, cancellerId: string) {
  if (!/^t[a-f0-9]+$/.test(ns) || !UUID.test(jobId) || !UUID.test(cancellerId)) {
    throw new Error('refusing to interpolate an unsafe trigger id');
  }
  const fn = `polo_gap_${ns}`;
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger
    LANGUAGE plpgsql AS $body$
    BEGIN
      IF NEW.processed_rows IS DISTINCT FROM OLD.processed_rows
         AND NEW.processed_rows > OLD.processed_rows
         AND NEW.id = '${jobId}'::uuid THEN
        INSERT INTO audit_log (org_id, user_id, action, target_type, target_id, diff)
        VALUES (
          NEW.org_id,
          '${cancellerId}'::uuid,
          'migration.cancel.requested',
          'MigrationJob',
          NEW.id::text,
          jsonb_build_object('attemptId', NEW.meta->>'attemptId')
        );
      END IF;
      RETURN NEW;
    END;
    $body$;
  `);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON migration_jobs`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER ${fn}
    BEFORE UPDATE ON migration_jobs
    FOR EACH ROW
    EXECUTE FUNCTION ${fn}()
  `);
  return fn;
}

async function dropTrigger(fn: string) {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON migration_jobs`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
}

describe('migration cancel gap', () => {
  t('a mark inserted on the bookkeeping update cancels instead of completing', async () => {
    const { ns, org, importer, canceller } = await orgWithUsers('gap');
    const attemptId = randomUUID();
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt: new Date(Date.now() - 1_000),
        meta: { entityType: 'companies', attemptId },
      },
    });
    const fn = await installBookkeepingTrigger(ns, job.id, canceller.id);
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
          attemptId,
        },
        deps(JSON.stringify([{ Name: 'Northwind Traders' }])),
        log,
      );
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe('CANCELLED');
      const audit = await prisma.auditLog.findFirst({
        where: { orgId: org.id, targetId: job.id, action: 'migration.cancel' },
      });
      expect(audit).not.toBeNull();
      expect(audit?.userId).toBe(canceller.id);
    } finally {
      await dropTrigger(fn);
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a mark on a chunk that does not finish the file does not leave the job running', async () => {
    const { ns, org, importer, canceller } = await orgWithUsers('partial');
    const attemptId = randomUUID();
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 4,
        startedAt: new Date(Date.now() - 1_000),
        meta: { entityType: 'companies', attemptId },
      },
    });
    const fn = await installBookkeepingTrigger(ns, job.id, canceller.id);
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
          totalRows: 4,
          redisKey: 'rows',
          mappings: { Name: 'company.name' },
          dedupStrategy: 'skip',
          attemptId,
        },
        deps(JSON.stringify([{ Name: 'Partial Co' }])),
        log,
      );
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe('CANCELLED');
      expect(stored.status).not.toBe('RUNNING');
      const audit = await prisma.auditLog.findFirst({
        where: { orgId: org.id, targetId: job.id, action: 'migration.cancel' },
      });
      expect(audit?.userId).toBe(canceller.id);
    } finally {
      await dropTrigger(fn);
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('cancel, then fail, then retry, and the retry imports', async () => {
    const { org, importer, canceller } = await orgWithUsers('retry');
    const attempt1 = randomUUID();
    const attempt2 = randomUUID();
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt: new Date(Date.now() - 60_000),
        meta: { entityType: 'companies', attemptId: attempt1 },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: canceller.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
        diff: { attemptId: attempt1 },
      },
    });
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorSummary: [{ row: 0, field: null, message: 'stale' }],
      },
    });
    const retryAt = new Date();
    await prisma.migrationJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        startedAt: retryAt,
        completedAt: null,
        processedRows: 0,
        errorRows: 0,
        errorSummary: [],
        meta: { entityType: 'companies', attemptId: attempt2 },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        action: 'migration.retry',
        targetType: 'MigrationJob',
        targetId: job.id,
        diff: { previousAttempt: attempt1, attemptId: attempt2 },
        at: retryAt,
      },
    });
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
          attemptId: attempt2,
        },
        deps(JSON.stringify([{ Name: 'Retry Co' }])),
        log,
      );
      expect(await prisma.company.count({ where: { orgId: org.id, deletedAt: null } })).toBe(1);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).not.toBe('CANCELLED');
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a dead worker with a pending cancel is cancelled, not failed', async () => {
    const { org, importer, canceller } = await orgWithUsers('sweep');
    const attemptId = randomUUID();
    const past = new Date(Date.now() - 16 * 60_000);
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 120,
        processedRows: 0,
        errorRows: 0,
        startedAt: past,
        meta: { entityType: 'companies', attemptId, progressAt: past.toISOString() },
      },
    });
    await prisma.$executeRaw`
      UPDATE migration_jobs SET updated_at = ${past} WHERE id = ${job.id}::uuid
    `;
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: canceller.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
        diff: { attemptId },
        at: new Date(Date.now() - 10 * 60_000),
      },
    });
    try {
      await sweepStaleMigrations(new Date());
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe('CANCELLED');
      const summary = stored.errorSummary as Array<{ message?: string }>;
      expect(summary.some((row) => row.message === 'stale')).toBe(false);
      const audit = await prisma.auditLog.findFirst({
        where: { orgId: org.id, targetId: job.id, action: 'migration.cancel' },
      });
      expect(audit?.userId).toBe(canceller.id);
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a stale new attempt is not cancelled by the previous attempt mark', async () => {
    const { org, importer, canceller } = await orgWithUsers('oldmark');
    const attempt1 = randomUUID();
    const attempt2 = randomUUID();
    const past = new Date(Date.now() - 16 * 60_000);
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 120,
        startedAt: past,
        meta: { entityType: 'companies', attemptId: attempt2, progressAt: past.toISOString() },
      },
    });
    await prisma.$executeRaw`
      UPDATE migration_jobs SET updated_at = ${past} WHERE id = ${job.id}::uuid
    `;
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: canceller.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
        diff: { attemptId: attempt1 },
        at: new Date(),
      },
    });
    try {
      await sweepStaleMigrations(new Date());
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

  t('a two-chunk locked cancel writes one migration.cancel and no cancel.lost', async () => {
    // WHY: both chunks see the mark. The second applyMarkedCancel used to
    // record migration.cancel.lost after the first had already cancelled.
    const { org, importer, canceller } = await orgWithUsers('two');
    const attemptId = randomUUID();
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 2,
        startedAt: new Date(Date.now() - 1_000),
        meta: { entityType: 'companies', attemptId },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: canceller.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
        diff: { attemptId },
      },
    });
    let arrived = 0;
    let releaseBoth!: () => void;
    const bothAtCancel = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const chunkDeps = (offset: number): MigrationChunkDeps => ({
      ...deps(JSON.stringify([{ Name: `Chunk ${offset}` }])),
      onMarkedCancel: async () => {
        arrived += 1;
        if (arrived >= 2) releaseBoth();
        await bothAtCancel;
      },
    });
    const chunk = (offset: number) =>
      processMigrationChunk(
        {
          migrationJobId: job.id,
          orgId: org.id,
          userId: importer.id,
          source: 'CSV',
          entityType: 'companies',
          chunkOffset: offset,
          chunkSize: 1,
          totalRows: 2,
          redisKey: 'rows',
          mappings: { Name: 'company.name' },
          dedupStrategy: 'skip',
          attemptId,
        },
        chunkDeps(offset),
        log,
      );
    try {
      await Promise.all([chunk(0), chunk(1)]);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe('CANCELLED');
      expect(await prisma.company.count({ where: { orgId: org.id, deletedAt: null } })).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { orgId: org.id, targetId: job.id, action: 'migration.cancel' },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { orgId: org.id, targetId: job.id, action: 'migration.cancel.lost' },
        }),
      ).toBe(0);
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('an accepted cancel still cancels the next chunk after the database clock passes 150s', async () => {
    // WHY: the mark used to expire at 150s. A later chunk of the same attempt
    // then imported the row and the job completed with no migration.cancel.
    // The age is Postgres NOW(), not the test process clock.
    const { org, importer, canceller } = await orgWithUsers('ttl');
    const attemptId = randomUUID();
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        meta: { entityType: 'companies', attemptId },
      },
    });
    await prisma.$executeRaw`
      UPDATE migration_jobs
      SET started_at = NOW() - interval '10 minutes'
      WHERE id = ${job.id}::uuid
    `;
    await prisma.$executeRaw`
      INSERT INTO audit_log (org_id, user_id, action, target_type, target_id, diff, at)
      VALUES (
        ${org.id}::uuid,
        ${canceller.id}::uuid,
        'migration.cancel.requested',
        'MigrationJob',
        ${job.id},
        jsonb_build_object('attemptId', ${attemptId}::text),
        NOW() - interval '5 minutes'
      )
    `;
    const age = await prisma.$queryRaw<Array<{ seconds: number }>>`
      SELECT EXTRACT(EPOCH FROM (NOW() - at))::float8 AS seconds
      FROM audit_log
      WHERE target_id = ${job.id}
        AND action = 'migration.cancel.requested'
      ORDER BY at DESC
      LIMIT 1
    `;
    expect(age[0]?.seconds ?? 0).toBeGreaterThan(150);
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
          attemptId,
        },
        deps(JSON.stringify([{ Name: 'Late Cancel Co' }])),
        log,
      );
      expect(await prisma.company.count({ where: { orgId: org.id, deletedAt: null } })).toBe(0);
      const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(stored.status).toBe('CANCELLED');
      const audits = await prisma.auditLog.findMany({
        where: { orgId: org.id, targetId: job.id, action: 'migration.cancel' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.userId).toBe(canceller.id);
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a mark already present means the chunk issues no insert', async () => {
    const { ns, org, importer, canceller } = await orgWithUsers('pre');
    const attemptId = randomUUID();
    const companyName = `Probe ${ns}`;
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: importer.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        startedAt: new Date(Date.now() - 1_000),
        meta: { entityType: 'companies', attemptId },
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        userId: canceller.id,
        action: 'migration.cancel.requested',
        targetType: 'MigrationJob',
        targetId: job.id,
        diff: { attemptId },
      },
    });
    const seq = `polo_ins_${ns}`;
    await prisma.$executeRawUnsafe(`CREATE SEQUENCE ${seq}`);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${seq}() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        IF NEW.name = '${companyName.replace(/'/g, '')}' THEN
          PERFORM nextval('${seq}');
        END IF;
        RETURN NEW;
      END;
      $body$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${seq}
      BEFORE INSERT ON companies
      FOR EACH ROW
      EXECUTE FUNCTION ${seq}()
    `);
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
          attemptId,
        },
        deps(JSON.stringify([{ Name: companyName }])),
        log,
      );
      const called = await prisma.$queryRawUnsafe<Array<{ is_called: boolean }>>(
        `SELECT is_called FROM ${seq}`,
      );
      expect(called[0]?.is_called).toBe(false);
      expect(await prisma.company.count({ where: { orgId: org.id, deletedAt: null } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${seq} ON companies`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${seq}()`);
      await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS ${seq}`);
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });
});
