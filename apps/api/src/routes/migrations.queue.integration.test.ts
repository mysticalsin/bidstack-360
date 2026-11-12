// buildServer() decorates server.redis. Start goes through that client and
// returns 2xx. Retry still claims RUNNING before getQueue().

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
  org = await createIsolatedOrg('migration-queue');
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

describe('migration queue acquisition', () => {
  t('a retry whose queue cannot be opened does not stay running', async () => {
    // WHY: getQueue() runs after the RUNNING claim and outside the catch, so a
    // throw on duplicate leaves the job running and the HTTP call 500s.
    const user = await prisma.user.findFirstOrThrow({
      where: { orgId: org.orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const job = await prisma.migrationJob.create({
      data: {
        orgId: org.orgId,
        userId: user.id,
        source: 'CSV',
        status: 'FAILED',
        totalRows: 1,
        meta: { entityType: 'company', mappings: { name: 'company.name' }, dedupStrategy: 'update' },
      },
    });
    const { redis } = await import('../redis.js');
    const duplicate = vi.spyOn(redis, 'duplicate').mockImplementation(() => {
      throw new Error('duplicate down');
    });
    try {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/migrations/${job.id}/retry`,
      });
      expect(res.statusCode).toBe(200);
      const again = await prisma.migrationJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(again.status).toBe('FAILED');
    } finally {
      duplicate.mockRestore();
    }
  });

  t('a start that cannot store its rows does not leave a pending job', async () => {
    // WHY: the handler creates the job before redis.set. A throw there returns
    // 500 and leaves the row PENDING, which the wizard never shows.
    const { redis } = await import('../redis.js');
    const set = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('redis down'));
    const before = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
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
      expect(res.statusCode).toBe(500);
    } finally {
      set.mockRestore();
    }
    const pending = await prisma.migrationJob.count({
      where: { orgId: org.orgId, status: 'PENDING' },
    });
    expect(pending).toBe(before);
  });

  t('starts a csv import on the process Redis client', async () => {
    // WHY: buildServer() has to hand the route the same Redis the process
    // already connected. A start that cannot see that client returns 500.
    expect(server.redis).toBeTruthy();
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
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; status: string }>();
    expect(body.status).toBe('RUNNING');
    const job = await prisma.migrationJob.findUniqueOrThrow({ where: { id: body.id } });
    expect(job.status).toBe('RUNNING');
  });
});
