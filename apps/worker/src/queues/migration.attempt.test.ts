// WHY: a retry starts a new attempt while chunks from the previous attempt
// are still in the queue. Those chunks must not import again, must not skip
// a row the new attempt still owns, and must not mark the job complete.

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

const PREVIOUS = '11111111-1111-4111-8111-111111111111';
const CURRENT = '22222222-2222-4222-8222-222222222222';

describe('migration attempt fence', () => {
  t('a chunk from the previous attempt is refused after a retry', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_attempt_${ns}`, name: `attempt ${ns}` },
    });
    const user = await prisma.user.create({
      data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'Attempt' },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 1,
        startedAt: new Date(),
        meta: { entityType: 'companies', attemptId: CURRENT },
      },
    });
    let reads = 0;
    const deps: MigrationChunkDeps = {
      readRows: async () => {
        reads += 1;
        return JSON.stringify([{ Name: 'Acme' }]);
      },
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    };
    const log = { info: () => undefined, warn: () => undefined };
    const payload = {
      migrationJobId: job.id,
      orgId: org.id,
      userId: user.id,
      source: 'CSV' as const,
      entityType: 'companies',
      chunkOffset: 0,
      chunkSize: 100,
      totalRows: 1,
      redisKey: 'rows',
      mappings: { Name: 'company.name' },
      dedupStrategy: 'skip' as const,
      attemptId: PREVIOUS,
    };

    await processMigrationChunk(payload, deps, log);
    const afterStale = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(reads).toBe(0);
    expect(afterStale.status).toBe('RUNNING');
    expect(afterStale.processedRows).toBe(1);

    await processMigrationChunk({ ...payload, attemptId: CURRENT }, { ...deps, readRows: async () => '[]' }, log);
    const afterCurrent = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(afterCurrent.status).toBe('COMPLETE');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });
});
