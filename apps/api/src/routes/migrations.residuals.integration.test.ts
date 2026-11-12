// The races file already spends the start-csv rate limit. These two
// residuals need their own server so they do not turn a later race into 429.

import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';

let server: FastifyInstance;
let org: IsolatedOrg;
let restoreAuth: () => void;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('migration-residuals');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

async function failedCsvJob(options?: { undoableUntil?: Date }) {
  const user = await prisma.user.findFirstOrThrow({
    where: { orgId: org.orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const job = await prisma.migrationJob.create({
    data: {
      orgId: org.orgId,
      userId: user.id,
      source: 'CSV',
      status: 'FAILED',
      totalRows: 1,
      completedAt: new Date(),
      undoableUntil: options?.undoableUntil,
      meta: { entityType: 'company', mappings: { name: 'company.name' }, dedupStrategy: 'update' },
    },
  });
  await server.redis.set(
    `migration:${job.id}:company:rows`,
    JSON.stringify([{ name: 'Acme' }]),
    'EX',
    3600,
  );
  return job;
}

describe('migration residual failures', () => {
  t('a retry after undo does not stay marked undone', async () => {
    // WHY: undo of a job that saved nothing sets meta.undone. Retry copies
    // that meta, so the new attempt still looks undone after it imports.
    const created = await failedCsvJob({ undoableUntil: new Date(Date.now() + 60 * 60 * 1000) });
    const add = vi.spyOn(Queue.prototype, 'add').mockResolvedValue({ id: 'chunk' } as never);
    try {
      const undo = await server.inject({
        method: 'DELETE',
        url: `/api/v1/migrations/${created.id}/undo`,
      });
      expect(undo.statusCode).toBe(200);
      const undone = await prisma.migrationJob.findUniqueOrThrow({ where: { id: created.id } });
      expect((undone.meta as { undone?: boolean }).undone).toBe(true);
      add.mockResolvedValue({ id: 'chunk' } as never);
      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${created.id}/retry`,
      });
      expect(retry.statusCode).toBe(200);
      const again = await prisma.migrationJob.findUniqueOrThrow({ where: { id: created.id } });
      expect(again.status).toBe('RUNNING');
      expect((again.meta as { undone?: boolean }).undone).not.toBe(true);
      expect((again.meta as { undoneAt?: string }).undoneAt).toBeUndefined();
    } finally {
      add.mockRestore();
    }
  });

  t('a partial enqueue does not leave the pending job', async () => {
    // WHY: if the bulk enqueue throws, the start removes the PENDING job
    // and its stored rows. The response never names that job.
    let jobId = '';
    const add = vi.spyOn(Queue.prototype, 'addBulk').mockImplementation(async (jobs) => {
      const payload = jobs[0]?.data as { migrationJobId?: string } | undefined;
      if (payload?.migrationJobId) jobId = payload.migrationJobId;
      throw new Error('queue down');
    });
    try {
      const rows = Array.from({ length: 101 }, (_, i) => ({ name: `Co ${i}` }));
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows,
          mappings: { name: 'company.name' },
        },
      });
      expect(res.statusCode).toBe(409);
      expect(await prisma.migrationJob.findUnique({ where: { id: jobId } })).toBeNull();
      expect(await server.redis.get(`migration:${jobId}:company:rows`)).toBeNull();
      expect(
        await prisma.auditLog.count({
          where: { orgId: org.orgId, targetId: jobId, action: 'migration.start' },
        }),
      ).toBe(0);
    } finally {
      add.mockRestore();
    }
  });
});
