// WHY: a retry can land after the opening attempt check and before the
// guarded commit. The old chunk then inserts rows the commit refuses to
// track. Undo cannot see them, and the new attempt collides with them.

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

const PREVIOUS = '11111111-1111-4111-8111-111111111111';
const CURRENT = '22222222-2222-4222-8222-222222222222';

async function orgUser(label: string) {
  const ns = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const org = await prisma.org.create({
    data: { clerkOrg: `org_mig_orphan_${ns}`, name: `${label} ${ns}` },
  });
  const user = await prisma.user.create({
    data: { orgId: org.id, clerkUser: `user_${ns}`, email: `${ns}@test.local`, name: label },
  });
  return { org, user };
}

/** The opening read still sees PREVIOUS. The stored attempt is already CURRENT. */
function flipAttemptOnOpeningRead(jobId: string) {
  const original = prisma.migrationJob.findUnique.bind(prisma.migrationJob);
  let flipped = false;
  return vi.spyOn(prisma.migrationJob, 'findUnique').mockImplementation(async (args) => {
    const row = await original(args as never);
    const id = args && typeof args === 'object' ? (args as { where?: { id?: string } }).where?.id : undefined;
    const wantsMeta = Boolean(
      args && typeof args === 'object' && (args as { select?: { meta?: boolean } }).select?.meta,
    );
    if (!flipped && id === jobId && wantsMeta) {
      flipped = true;
      const meta = (row?.meta ?? {}) as Record<string, unknown>;
      await prisma.migrationJob.update({
        where: { id: jobId },
        data: { meta: { ...meta, attemptId: CURRENT } },
      });
    }
    return row;
  });
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

describe('migration rows stay with the attempt that owns them', () => {
  t('a no-email contact retry does not leave rows undo cannot remove', async () => {
    for (const dedupStrategy of ['skip', 'duplicate'] as const) {
      const { org, user } = await orgUser(`contact-${dedupStrategy}`);
      const job = await prisma.migrationJob.create({
        data: {
          orgId: org.id,
          userId: user.id,
          source: 'CSV',
          status: 'RUNNING',
          totalRows: 3,
          processedRows: 0,
          startedAt: new Date(),
          meta: { entityType: 'contacts', attemptId: PREVIOUS },
        },
      });
      const rows = [{ Name: 'Ada' }, { Name: 'Bea' }, { Name: 'Cy' }];
      const payload = {
        migrationJobId: job.id,
        orgId: org.id,
        userId: user.id,
        source: 'CSV' as const,
        entityType: 'contacts',
        chunkOffset: 0,
        chunkSize: 100,
        totalRows: 3,
        redisKey: 'rows',
        mappings: { Name: 'contact.name' },
        dedupStrategy,
        attemptId: PREVIOUS,
      };
      const read = flipAttemptOnOpeningRead(job.id);
      try {
        await processMigrationChunk(payload, deps(rows), log);
      } finally {
        read.mockRestore();
      }
      await processMigrationChunk({ ...payload, attemptId: CURRENT }, deps(rows), log);
      const created = await prisma.contact.count({ where: { orgId: org.id, deletedAt: null } });
      expect(created, dedupStrategy).toBe(3);
      const audits = await prisma.auditLog.findMany({
        where: { orgId: org.id, action: 'migration.chunk.imported', targetId: job.id },
        select: { diff: true },
      });
      const ids = audits.flatMap((row) => {
        const diff = row.diff as { createdIds?: string[] } | null;
        return diff?.createdIds ?? [];
      });
      if (ids.length > 0) {
        await prisma.contact.deleteMany({ where: { orgId: org.id, id: { in: ids } } });
      }
      const left = await prisma.contact.count({ where: { orgId: org.id, deletedAt: null } });
      expect(left, dedupStrategy).toBe(0);
      await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  t('a company retry does not finish with errors for rows the old attempt already inserted', async () => {
    const { org, user } = await orgUser('company');
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 3,
        processedRows: 0,
        startedAt: new Date(),
        meta: { entityType: 'companies', attemptId: PREVIOUS },
      },
    });
    const rows = [{ Name: 'Acme' }, { Name: 'Beta' }, { Name: 'Gamma' }];
    const payload = {
      migrationJobId: job.id,
      orgId: org.id,
      userId: user.id,
      source: 'CSV' as const,
      entityType: 'companies',
      chunkOffset: 0,
      chunkSize: 100,
      totalRows: 3,
      redisKey: 'rows',
      mappings: { Name: 'company.name' },
      dedupStrategy: 'duplicate' as const,
      attemptId: PREVIOUS,
    };
    const read = flipAttemptOnOpeningRead(job.id);
    try {
      await processMigrationChunk(payload, deps(rows), log);
    } finally {
      read.mockRestore();
    }
    await processMigrationChunk({ ...payload, attemptId: CURRENT }, deps(rows), log);
    const stored = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    const companies = await prisma.company.count({ where: { orgId: org.id, deletedAt: null } });
    expect(companies).toBe(3);
    expect(stored.processedRows).toBe(3);
    expect(stored.errorRows).toBe(0);
    expect(stored.status).toBe('COMPLETE');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('an old attempt writes no leads, opportunities, or financials', async () => {
    const { org, user } = await orgUser('rest');
    const company = await prisma.company.create({
      data: { orgId: org.id, name: 'Acme', source: 'manual' },
    });
    const cases = [
      {
        entityType: 'leads',
        rows: [{ First: 'Ada', Company: 'Acme' }],
        mappings: { First: 'lead.firstName', Company: 'lead.company' },
        count: () => prisma.lead.count({ where: { orgId: org.id, deletedAt: null } }),
      },
      {
        entityType: 'opportunities',
        rows: [{ Name: 'Deal' }],
        mappings: { Name: 'opportunity.name' },
        count: () => prisma.opportunity.count({ where: { orgId: org.id, deletedAt: null } }),
      },
      {
        entityType: 'financials',
        rows: [{ Company: 'Acme', End: '2024-12-31', Revenue: '10' }],
        mappings: {
          Company: 'financial.companyName',
          End: 'financial.periodEnd',
          Revenue: 'financial.revenue',
        },
        count: () => prisma.accountFinancialPeriod.count({ where: { orgId: org.id, companyId: company.id } }),
      },
    ];
    for (const item of cases) {
      const job = await prisma.migrationJob.create({
        data: {
          orgId: org.id,
          userId: user.id,
          source: 'CSV',
          status: 'RUNNING',
          totalRows: 1,
          processedRows: 0,
          startedAt: new Date(),
          meta: { entityType: item.entityType, attemptId: PREVIOUS },
        },
      });
      const read = flipAttemptOnOpeningRead(job.id);
      try {
        await processMigrationChunk(
          {
            migrationJobId: job.id,
            orgId: org.id,
            userId: user.id,
            source: 'CSV',
            entityType: item.entityType,
            chunkOffset: 0,
            chunkSize: 100,
            totalRows: 1,
            redisKey: 'rows',
            mappings: item.mappings,
            dedupStrategy: 'duplicate',
            attemptId: PREVIOUS,
          },
          deps(item.rows),
          log,
        );
      } finally {
        read.mockRestore();
      }
      expect(await item.count(), item.entityType).toBe(0);
      await prisma.migrationJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETE', completedAt: new Date() },
      });
    }
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  t('one bad company row does not undo the good row in the same chunk', async () => {
    const { org, user } = await orgUser('mixed');
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.id,
        userId: user.id,
        source: 'CSV',
        status: 'RUNNING',
        totalRows: 2,
        processedRows: 0,
        startedAt: new Date(),
        meta: { entityType: 'companies', attemptId: CURRENT },
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
        attemptId: CURRENT,
      },
      deps([{ Name: 'Kept' }, { Name: '' }]),
      log,
    );
    const after = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(await prisma.company.count({ where: { orgId: org.id, deletedAt: null } })).toBe(1);
    expect(after.processedRows).toBe(1);
    expect(after.errorRows).toBe(1);
    expect(after.status).toBe('COMPLETE');
    await prisma.org.delete({ where: { id: org.id } }).catch(() => undefined);
  });
});
