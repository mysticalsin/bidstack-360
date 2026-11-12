// WHY: a deadlock aborts the Postgres transaction. Recording it as a row
// error keeps the other rows and stores process ids, transaction ids, and SQL.
// The chunk has to fail so the transaction rolls back and BullMQ retries it.

import { prisma } from '@bidstack/db';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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

const ATTEMPT = '33333333-3333-4333-8333-333333333333';

async function orgUser() {
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_mig_dead_${ns}`, name: `dead ${ns}` },
  });
  const user = await prisma.user.create({
    data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'dead' },
  });
  return { org, user };
}

const log = { info: () => undefined, warn: () => undefined };

function deps(rows: unknown[]): MigrationChunkDeps {
  return {
    readRows: async () => JSON.stringify(rows),
    enqueueChunk: async () => undefined,
    enqueueIntel: async () => undefined,
    env: {},
  };
}

const DEADLOCK_DETAIL =
  'deadlock detected\nDETAIL: Process 4242 waits for ShareLock on transaction 999; blocked by process 4243.\nProcess 4243 waits for ShareLock on transaction 1000; blocked by process 4242.\nQUERY: INSERT INTO "companies" ("org_id","name") VALUES ($1,$2)';

/** The second company insert raises 40P01 after the first insert has run. */
function deadlockOnSecondCompany() {
  const original = prisma.$transaction.bind(prisma);
  let inserts = 0;
  return vi.spyOn(prisma, '$transaction').mockImplementation((async (fn: unknown, opts?: unknown) => {
    if (typeof fn !== 'function') return original(fn as never, opts as never);
    return original(async (tx: { company: { create: (args: unknown) => Promise<unknown> } }) => {
      const create = tx.company.create.bind(tx.company);
      tx.company.create = (async (args: unknown) => {
        inserts += 1;
        if (inserts === 2) {
          const err = new Error(DEADLOCK_DETAIL) as Error & { code: string };
          err.code = '40P01';
          throw err;
        }
        return create(args);
      }) as typeof tx.company.create;
      return (fn as (tx: unknown) => Promise<unknown>)(tx);
    }, opts);
  }) as never);
}

describe('a migration deadlock fails the chunk', () => {
  t('a 40P01 rolls the chunk back and the failure text has no process id, xid, or SQL', async () => {
    const { org, user } = await orgUser();
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 2,
        processedRows: 0,
        startedAt: new Date(),
        meta: { entityType: 'companies', attemptId: ATTEMPT },
      },
    });
    const spy = deadlockOnSecondCompany();
    let thrown: Error | undefined;
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
          totalRows: 2,
          redisKey: 'rows',
          mappings: { Name: 'company.name' },
          dedupStrategy: 'duplicate',
          attemptId: ATTEMPT,
        },
        deps([{ Name: 'Kept' }, { Name: 'Blocked' }]),
        log,
      );
    } catch (err) {
      thrown = err as Error;
    } finally {
      spy.mockRestore();
    }
    expect(thrown, 'chunk must fail so BullMQ retries it').toBeInstanceOf(Error);
    const text = `${thrown?.message ?? ''}`;
    expect(text).not.toMatch(/4242/);
    expect(text).not.toMatch(/transaction 999/);
    expect(text).not.toMatch(/INSERT INTO/i);
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    const summary = JSON.stringify(stored.errorSummary);
    expect(summary).not.toMatch(/4242/);
    expect(summary).not.toMatch(/transaction 999/);
    expect(summary).not.toMatch(/INSERT INTO/i);
    expect(await prisma.company.count({ where: { orgId: org.id, deletedAt: null } })).toBe(0);
    expect(stored.processedRows).toBe(0);
    expect(stored.status).toBe('RUNNING');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });
});
