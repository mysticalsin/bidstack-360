// WHY: the chunk writes with the payload's org. The locked job row is the
// source of that org. A payload for a different org must not insert rows.

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

const ATTEMPT = '55555555-5555-4555-8555-555555555555';

async function orgUser(label: string) {
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_mig_${label}_${ns}`, name: `${label} ${ns}` },
  });
  const user = await prisma.user.create({
    data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: label },
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

describe('a chunk uses the org on the locked job', () => {
  t('a payload for another org inserts no companies', async () => {
    const owner = await orgUser('owner');
    const other = await orgUser('other');
    const job = await prisma.migrationJob.create({
      data: {
        orgId: owner.org.id,
        userId: owner.user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        startedAt: new Date(),
        meta: { entityType: 'companies', attemptId: ATTEMPT },
      },
    });
    await processMigrationChunk(
      {
        migrationJobId: job.id,
        orgId: other.org.id,
        userId: other.user.id,
        source: 'CSV',
        entityType: 'companies',
        chunkOffset: 0,
        chunkSize: 100,
        totalRows: 1,
        redisKey: 'rows',
        mappings: { Name: 'company.name' },
        dedupStrategy: 'duplicate',
        attemptId: ATTEMPT,
      },
      deps([{ Name: 'Foreign' }]),
      log,
    );
    expect(await prisma.company.count({ where: { orgId: other.org.id, deletedAt: null } })).toBe(0);
    expect(await prisma.company.count({ where: { orgId: owner.org.id, deletedAt: null } })).toBe(0);
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe('RUNNING');
    expect(stored.processedRows).toBe(0);
    expect((stored.meta as { progressAt?: string }).progressAt).toBeUndefined();
    await prisma.org.delete({ where: { id: owner.org.id } }).catch(() => undefined);
    await prisma.org.delete({ where: { id: other.org.id } }).catch(() => undefined);
  });
});
