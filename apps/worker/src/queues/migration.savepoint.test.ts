// WHY: a unique violation aborts the chunk transaction unless the row ran
// inside a savepoint. The next statement then fails with 25P02, so a later
// good company never lands and the job does not finish with one row error.
// This passes while the savepoint is in place and fails when it is removed.

import { prisma } from '@bidstack/db';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

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

const ATTEMPT = '44444444-4444-4444-8444-444444444444';

async function orgUser() {
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_mig_sp_${ns}`, name: `sp ${ns}` },
  });
  const user = await prisma.user.create({
    data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'sp' },
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

describe('a duplicate company name stays inside its row', () => {
  t('duplicate strategy records the name collision and still imports the next company', async () => {
    const { org, user } = await orgUser();
    try {
    await prisma.company.create({
      data: { orgId: org.id, name: 'Acme', source: 'manual', confidence: 1 },
    });
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
      deps([{ Name: 'Acme' }, { Name: 'Beta' }]),
      log,
    );
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    const names = (
      await prisma.company.findMany({
        where: { orgId: org.id, deletedAt: null },
        select: { name: true },
        orderBy: { name: 'asc' },
      })
    ).map((row) => row.name);
    expect(names).toEqual(['Acme', 'Beta']);
    expect(stored.processedRows).toBe(1);
    expect(stored.errorRows).toBe(1);
    expect(stored.status).toBe('COMPLETE');
    const summary = JSON.stringify(stored.errorSummary);
    expect(summary).not.toMatch(/25P02/);
    expect(summary).not.toMatch(/current transaction is aborted/);
    // The preview numbers the first data row 1. The error report must match.
    expect(summary).toContain('"row":1');
    } finally {
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });
});
