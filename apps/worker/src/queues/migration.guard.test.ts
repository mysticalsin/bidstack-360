// WHY: a chunk for an unsupported entity failed the job by id, so a cancel
// that landed after the status read was overwritten. A chunk that arrives
// before the RUNNING claim must be retried, and a finished job is left alone.

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

  t('a chunk waits while the job is still pending and skips a finished job', async () => {
    const pending = await fixture('PENDING');
    let reads = 0;
    const payload = {
      migrationJobId: pending.job.id,
      orgId: pending.org.id,
      userId: pending.job.userId,
      source: 'CSV' as const,
      entityType: 'companies',
      chunkOffset: 0,
      chunkSize: 100,
      totalRows: 1,
      redisKey: 'rows',
      mappings: { Name: 'company.name' },
      dedupStrategy: 'skip' as const,
    };
    // Start and retry enqueue before the RUNNING claim. Completing this chunk
    // would drop the rows, so the worker throws and BullMQ retries.
    await expect(
      processMigrationChunk(
        payload,
        deps(async () => {
          reads += 1;
          return JSON.stringify([{ Name: 'Acme' }]);
        }),
        log,
      ),
    ).rejects.toThrow(/not running yet/);
    expect(reads).toBe(0);
    const stillPending = await prisma.migrationJob.findUnique({ where: { id: pending.job.id } });
    expect(stillPending?.status).toBe('PENDING');
    await prisma.org.delete({ where: { id: pending.org.id } }).catch(() => undefined);

    const done = await fixture('COMPLETE');
    await processMigrationChunk(
      { ...payload, migrationJobId: done.job.id, orgId: done.org.id, userId: done.job.userId },
      deps(async () => {
        reads += 1;
        return JSON.stringify([{ Name: 'Acme' }]);
      }),
      log,
    );
    expect(reads).toBe(0);
    const stored = await prisma.migrationJob.findUnique({ where: { id: done.job.id } });
    expect(stored?.status).toBe('COMPLETE');
    await prisma.org.delete({ where: { id: done.org.id } }).catch(() => undefined);
  });

  t('a retry chunk waits while the job is still failed, then imports once it is running', async () => {
    // WHY: retry enqueues the chunk while the row is still FAILED, then
    // claims RUNNING and clears the stall clock. Acking the chunk in that
    // window leaves the job running with nothing left to process.
    const previous = 'attempt-previous';
    const next = 'attempt-next';
    const failed = await fixture('FAILED');
    await prisma.migrationJob.update({
      where: { id: failed.job.id },
      data: { meta: { entityType: 'companies', attemptId: previous } },
    });
    let reads = 0;
    const readRows = async () => {
      reads += 1;
      return JSON.stringify([{ Name: 'Acme' }]);
    };
    const csv = {
      migrationJobId: failed.job.id,
      orgId: failed.org.id,
      userId: failed.job.userId,
      source: 'CSV' as const,
      entityType: 'companies',
      chunkOffset: 0,
      chunkSize: 100,
      totalRows: 1,
      redisKey: 'rows',
      mappings: { Name: 'company.name' },
      dedupStrategy: 'skip' as const,
      attemptId: next,
    };
    await expect(processMigrationChunk(csv, deps(readRows), log)).rejects.toThrow(/not running yet/);
    const hubspot = { ...csv, source: 'HUBSPOT_OAUTH' as const };
    await expect(processMigrationChunk(hubspot, deps(readRows), log)).rejects.toThrow(/not running yet/);
    expect(reads).toBe(0);
    expect(await prisma.company.count({ where: { orgId: failed.org.id, deletedAt: null } })).toBe(0);

    await prisma.migrationJob.update({
      where: { id: failed.job.id },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        meta: { entityType: 'companies', attemptId: next },
      },
    });
    await processMigrationChunk(csv, deps(readRows), log);
    expect(reads).toBe(1);
    expect(await prisma.company.count({ where: { orgId: failed.org.id, deletedAt: null } })).toBe(1);
    await prisma.org.delete({ where: { id: failed.org.id } }).catch(() => undefined);
  });
});
