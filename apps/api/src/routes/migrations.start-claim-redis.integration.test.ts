// WHY: start-csv stores rows at migration:<id>:<entity>:rows before the
// PENDING → RUNNING claim. A lost claim returns 409 and does not enqueue.
// Those rows must not sit until the 1h TTL. The claim that did land still
// reads that key, so a loser must not delete it.

import { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';
import { retireActiveImports } from './migrations.test-helpers.js';

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
  org = await createIsolatedOrg('start-claim-redis');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
});

beforeEach(async () => {
  if (org) await retireActiveImports(org.orgId);
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

function start(rows: Array<Record<string, string>>) {
  return server.inject({
    method: 'POST',
    url: '/api/v1/migrations/start-csv',
    payload: {
      source: 'CSV',
      entityType: 'company',
      rows,
      mappings: { name: 'company.name' },
    },
  });
}

async function newestJob() {
  return prisma.migrationJob.findFirstOrThrow({
    where: { orgId: org.orgId },
    orderBy: { createdAt: 'desc' },
  });
}

function rowsKey(jobId: string): string {
  return `migration:${jobId}:company:rows`;
}

/** Move the job off PENDING while the start audit is written, so the claim loses. */
function loseClaimAtAudit(status: 'CANCELLED' | 'RUNNING'): () => void {
  const original = prisma.auditLog.create.bind(prisma.auditLog);
  const audit = vi.spyOn(prisma.auditLog, 'create').mockImplementation(async (args) => {
    const data = args.data as { action?: string; targetId?: string };
    if (data.action === 'migration.start' && data.targetId) {
      await prisma.migrationJob.update({
        where: { id: data.targetId },
        data: {
          status,
          ...(status === 'CANCELLED' ? { completedAt: new Date() } : { startedAt: new Date() }),
        },
      });
    }
    return original(args);
  });
  return () => audit.mockRestore();
}

describe('start-csv lost claim redis key', () => {
  t('a lost PENDING to RUNNING claim returns 409 and removes the rows it stored', async () => {
    // WHY: the 409 branch used to leave migration:<id>:company:rows until the
    // 1h TTL. Nothing is queued, so the key is not a job anyone will read.
    const restore = loseClaimAtAudit('CANCELLED');
    try {
      const res = await start([{ name: 'Lost claim' }]);
      expect(res.statusCode).toBe(409);
      expect(res.json<{ message: string }>().message).toBe('Migration job is no longer pending');
      const row = await newestJob();
      expect(row.status).toBe('CANCELLED');
      expect(await server.redis.get(rowsKey(row.id))).toBeNull();
    } finally {
      restore();
    }
  });

  t('a lost claim does not delete the key when the job is already RUNNING', async () => {
    // WHY: the key is shared by job id. The request that lost the claim is
    // not the one the worker will read. Deleting here would drop the winner's rows.
    const restore = loseClaimAtAudit('RUNNING');
    try {
      const payload = [{ name: 'Winner rows' }];
      const res = await start(payload);
      expect(res.statusCode).toBe(409);
      expect(res.json<{ message: string }>().message).toBe('Migration job is no longer pending');
      const row = await newestJob();
      expect(row.status).toBe('RUNNING');
      expect(await server.redis.get(rowsKey(row.id))).toBe(JSON.stringify(payload));
    } finally {
      restore();
    }
  });

  t('two starts of the same file return one 201 and one 409, and the winner keeps its rows', async () => {
    // WHY: the winning start is 201, the status this route returns when the
    // claim lands. The other start is 409. Each job id has its own key, and
    // the loser must not remove the key the winner's chunks read.
    const add = vi.spyOn(Queue.prototype, 'addBulk').mockResolvedValue([{ id: 'chunk' }] as never);
    const firstRows = [{ name: 'Same file', city: 'Lyon' }];
    const secondRows = [{ city: 'Lyon', name: 'Same file' }];
    try {
      const [first, second] = await Promise.all([start(firstRows), start(secondRows)]);
      const codes = [first.statusCode, second.statusCode].sort((a, b) => a - b);
      expect(codes).toEqual([201, 409]);
      const winner = first.statusCode === 201 ? first : second;
      const winnerRows = first.statusCode === 201 ? firstRows : secondRows;
      const winnerId = winner.json<{ id: string }>().id;
      expect(await server.redis.get(rowsKey(winnerId))).toBe(JSON.stringify(winnerRows));
    } finally {
      add.mockRestore();
    }
  });
});
