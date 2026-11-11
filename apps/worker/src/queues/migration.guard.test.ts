// WHY: a chunk for an unsupported entity failed the job by id, so a cancel
// that landed after the status read was overwritten. A chunk also kept going
// while the job was still pending or already complete.

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

const log = { info: () => undefined, warn: () => undefined };

async function fixture(status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'CANCELLED' | 'FAILED') {
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_mig_guard_${ns}`, name: `guard ${ns}` },
  });
  const user = await prisma.user.create({
    data: {
      orgId: org.id,
      clerkUser: `user_${ns}`,
      email: `${ns}@test.local`,
      name: 'Guard',
    },
  });
  const job = await prisma.migrationJob.create({
    data: { orgId: org.id, userId: user.id, source: 'CSV', status, totalRows: 1 },
  });
  return { org, user, job };
}

function deps(readRows: MigrationChunkDeps['readRows']): MigrationChunkDeps {
  return { readRows, enqueueChunk: async () => undefined, enqueueIntel: async () => undefined, env: {} };
}

describe('migration chunk guards', () => {
  t('an unsupported entity does not fail a job that was cancelled', async () => {
    const { org, job } = await fixture('CANCELLED');
    const original = prisma.migrationJob.findUnique.bind(prisma.migrationJob);
    const read = vi.spyOn(prisma.migrationJob, 'findUnique').mockImplementation(async (args) => {
      const row = await original(args as never);
      if (args && typeof args === 'object' && (args as { where?: { id?: string } }).where?.id === job.id && row) {
        return { ...row, status: 'RUNNING' };
      }
      return row;
    });
    try {
      await processMigrationChunk(
        {
          migrationJobId: job.id,
          orgId: org.id,
          userId: job.userId,
          source: 'CSV',
          entityType: 'not-an-entity',
          chunkOffset: 0,
          chunkSize: 100,
          totalRows: 1,
          redisKey: 'unused',
          mappings: {},
          dedupStrategy: 'skip',
        },
        deps(async () => '[]'),
        log,
      );
    } finally {
      read.mockRestore();
    }
    const stored = await prisma.migrationJob.findUnique({ where: { id: job.id } });
    expect(stored?.status).toBe('CANCELLED');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('a chunk does not import while the job is pending or complete', async () => {
    for (const status of ['PENDING', 'COMPLETE'] as const) {
      const { org, job } = await fixture(status);
      let reads = 0;
      await processMigrationChunk(
        {
          migrationJobId: job.id,
          orgId: org.id,
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
        deps(async () => {
          reads += 1;
          return JSON.stringify([{ Name: 'Acme' }]);
        }),
        log,
      );
      expect(reads).toBe(0);
      const stored = await prisma.migrationJob.findUnique({ where: { id: job.id } });
      expect(stored?.status).toBe(status);
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });
});
