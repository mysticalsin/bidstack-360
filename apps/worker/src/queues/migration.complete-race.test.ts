// WHY: maybeComplete reads RUNNING and then updates by id. A cancel that
// lands between those two calls must not be overwritten with COMPLETE.

import { prisma, seedOrgData } from '@bidstack/db';
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

describe('migration complete compare-and-set', () => {
  t('a cancel between the read and the write is not overwritten', async () => {
    const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const org = await prisma.org.create({
      data: { clerkOrg: `org_mig_complete_${ns}`, name: `complete ${ns}` },
    });
    await seedOrgData(prisma, org.id, {
      ownerEmail: `admin.${ns}@test.local`,
      ownerName: 'Test Admin',
      namespace: ns,
    });
    const user = await prisma.user.findFirstOrThrow({
      where: { orgId: org.id },
      orderBy: { createdAt: 'asc' },
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
      },
    });

    const original = prisma.migrationJob.findUnique.bind(prisma.migrationJob);
    const read = vi.spyOn(prisma.migrationJob, 'findUnique').mockImplementation(async (args) => {
      const row = await original(args as never);
      const id = args && typeof args === 'object' ? (args as { where?: { id?: string } }).where?.id : undefined;
      if (id === job.id) {
        await prisma.migrationJob.update({
          where: { id: job.id },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });
        return row ? { ...row, status: 'RUNNING' as const } : row;
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
      // processMigrationChunk is the export that exists on the parent. The
      // assertion is the stored status, so a by-id complete fails the test
      // even when the helper is exported.
      await processMigrationChunk(
        {
          migrationJobId: job.id,
          orgId: org.id,
          userId: user.id,
          source: 'CSV',
          entityType: 'companies',
          chunkOffset: 0,
          chunkSize: 100,
          totalRows: 1,
          redisKey: 'rows',
          mappings: {},
          dedupStrategy: 'skip',
        },
        deps,
        { info: () => undefined, warn: () => undefined },
      );
    } finally {
      read.mockRestore();
    }
    const row = await prisma.migrationJob.findUnique({ where: { id: job.id } });
    // The read told maybeComplete the job was still RUNNING. The cancel had
    // already landed. The write must not replace that cancel.
    expect(row?.status).toBe('CANCELLED');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });
});
