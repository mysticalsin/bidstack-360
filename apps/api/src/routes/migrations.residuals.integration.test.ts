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

async function newestJob() {
  return prisma.migrationJob.findFirstOrThrow({
    where: { orgId: org.orgId },
    orderBy: { createdAt: 'desc' },
  });
}

describe('migration residual failures', () => {
  t('a retry after undo does not stay marked undone', async () => {
    // WHY: undo of a job that saved nothing sets meta.undone. Retry copies
    // that meta, so the new attempt still looks undone after it imports.
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    const add = vi.spyOn(Queue.prototype, 'add').mockRejectedValueOnce(new Error('queue down'));
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Acme' }],
          mappings: { name: 'company.name' },
        },
      });
      expect(res.statusCode).toBe(409);
      const created = await newestJob();
      expect(created.status).toBe('PENDING');
      await prisma.migrationJob.update({
        where: { id: created.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          undoableUntil: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
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

  t('a partial enqueue keeps the row error and the pending job', async () => {
    // WHY: a later chunk that cannot be queued must not replace the row error
    // or mark the job failed. The start never claimed it.
    const { redis } = await import('../redis.js');
    (server as unknown as { redis: typeof redis }).redis = redis;
    const add = vi.spyOn(Queue.prototype, 'add').mockImplementation(async (name, data) => {
      const payload = data as { migrationJobId?: string; chunkOffset?: number };
      if ((payload.chunkOffset ?? 0) > 0 && payload.migrationJobId) {
        await prisma.migrationJob.update({
          where: { id: payload.migrationJobId },
          data: {
            processedRows: 1,
            errorRows: 1,
            errorSummary: [{ row: 5, field: 'company.name', message: 'company.name is required' }],
          },
        });
        throw new Error('queue down');
      }
      return { id: String(name) } as never;
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
      const created = await newestJob();
      expect(created.status).toBe('PENDING');
      const csv = await server.inject({
        method: 'GET',
        url: `/api/v1/migrations/${created.id}/errors.csv`,
      });
      expect(csv.statusCode).toBe(200);
      expect(csv.body).toContain('company.name is required');
      expect(csv.body).not.toContain('The import did not start');
    } finally {
      add.mockRestore();
    }
  });
});
