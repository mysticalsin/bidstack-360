// WHY: a retry starts a new attempt while chunks from the previous attempt
// are still in the queue. Those chunks must not import again, must not skip
// a row the new attempt still owns, and must not mark the job complete.

import { prisma } from '@bidstack/db';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  commitChunkProgress,
  maybeComplete,
  processMigrationChunk,
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

  t('both copies of chunk 0 are consumed and only the new attempt is processed', async () => {
    // WHY: retry enqueues chunk 0 again while the original is still queued.
    // The attempt on the job is the one retry just minted. The older copy
    // must be a no-op, so the row is imported once.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_both_${ns}`, name: `both ${ns}` },
    });
    const user = await prisma.user.create({
      data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'Both' },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
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
      dedupStrategy: 'duplicate' as const,
      attemptId: PREVIOUS,
    };
    await processMigrationChunk(payload, deps, log);
    await processMigrationChunk({ ...payload, attemptId: CURRENT }, deps, log);
    const companies = await prisma.company.count({ where: { orgId: org.id } });
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(reads).toBe(1);
    expect(companies).toBe(1);
    expect(stored.processedRows).toBe(1);
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('a claim does not put back an attempt a retry already replaced', async () => {
    // WHY: the claim used to write the whole meta from a snapshot. A retry
    // that minted a new attempt between that read and the write lost its id,
    // and the old chunk could keep running as the current attempt.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_claim_${ns}`, name: `claim ${ns}` },
    });
    const user = await prisma.user.create({
      data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'Claim' },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        startedAt: new Date(),
        meta: { entityType: 'companies', attemptId: PREVIOUS },
      },
    });
    const original = prisma.migrationJob.findUnique.bind(prisma.migrationJob);
    let reads = 0;
    let stale: unknown;
    const read = vi.spyOn(prisma.migrationJob, 'findUnique').mockImplementation(async (args) => {
      const row = await original(args as never);
      const id = args && typeof args === 'object' ? (args as { where?: { id?: string } }).where?.id : undefined;
      const wantsMeta = Boolean(
        args && typeof args === 'object' && (args as { select?: { meta?: boolean } }).select?.meta,
      );
      if (id === job.id && wantsMeta) {
        reads += 1;
        if (reads === 1) {
          stale = row;
          await prisma.migrationJob.update({
            where: { id: job.id },
            data: { meta: { entityType: 'companies', attemptId: CURRENT } },
          });
          return row;
        }
        if (reads === 2 && stale) return stale;
      }
      return row;
    });
    const deps: MigrationChunkDeps = {
      readRows: async () => '[]',
      enqueueChunk: async () => undefined,
      enqueueIntel: async () => undefined,
      env: {},
    };
    try {
      await processMigrationChunk(
        {
          migrationJobId: job.id,
          orgId: org.id,
          userId: user.id,
          source: 'CSV',
          entityType: 'tasks',
          chunkOffset: 0,
          chunkSize: 100,
          totalRows: 1,
          redisKey: 'rows',
          mappings: {},
          dedupStrategy: 'skip',
          attemptId: PREVIOUS,
        },
        deps,
        { info: () => undefined, warn: () => undefined },
      );
    } finally {
      read.mockRestore();
    }
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    const meta = stored.meta as { attemptId?: string; progressAt?: string };
    expect(meta.attemptId).toBe(CURRENT);
    expect(meta.progressAt).toEqual(expect.any(String));
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('an old attempt cannot commit rows or complete the job', async () => {
    // WHY: a chunk that already passed the opening check can still finish
    // after retry has replaced the attempt. The commit and the complete
    // write have to see the attempt that is current then.
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_old_${ns}`, name: `old ${ns}` },
    });
    const user = await prisma.user.create({
      data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: 'Old' },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 1,
        processedRows: 0,
        startedAt: new Date(),
        meta: { entityType: 'companies', attemptId: CURRENT },
      },
    });
    const log = { info: () => undefined, warn: () => undefined };
    await commitChunkProgress({
      orgId: org.id,
      userId: user.id,
      migrationJobId: job.id,
      entity: 'company',
      chunkOffset: 0,
      resumeFrom: 0,
      createdIds: [],
      processed: 1,
      errors: [],
      attemptId: PREVIOUS,
    });
    const afterOld = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    const oldAudits = await prisma.auditLog.count({
      where: { orgId: org.id, targetId: job.id, action: 'migration.chunk.imported' },
    });
    expect(afterOld.processedRows).toBe(0);
    expect(afterOld.status).toBe('RUNNING');
    expect(oldAudits).toBe(0);
    await prisma.migrationJob.update({ where: { id: job.id }, data: { processedRows: 1 } });
    await maybeComplete(job.id, undefined, log, PREVIOUS);
    const afterComplete = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(afterComplete.status).toBe('RUNNING');
    await maybeComplete(job.id, undefined, log, CURRENT);
    const done = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('COMPLETE');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });
});
