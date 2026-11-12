// The migrations queue keeps its own Redis connection. After that connection
// is closed, the next start has to bring it back. A process restart is not
// required.

import { Queue } from 'bullmq';
import type Redis from 'ioredis';
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
import { retireActiveImports } from './migrations.test-helpers.js';

let server: FastifyInstance;
let org: IsolatedOrg;
let restoreAuth: () => void;
let dbReachable = false;
const opened: Redis[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const { redis } = await import('../redis.js');
  const duplicate = redis.duplicate.bind(redis);
  vi.spyOn(redis, 'duplicate').mockImplementation((override) => {
    const connection = duplicate(override);
    opened.push(connection);
    return connection;
  });
  org = await createIsolatedOrg('migration-redis');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

describe('migration queue reconnect', () => {
  t('a start after the queue connection closed returns 201', async () => {
    // WHY: the queue connection is separate from the process client. Once it
    // stopped, later starts kept failing until the API process restarted.
    const start = (name: string) =>
      server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name }],
          mappings: { name: 'company.name' },
        },
      });

    const first = await start('Before outage');
    expect(first.statusCode).toBe(201);
    expect(opened.length).toBeGreaterThan(0);
    await retireActiveImports(org.orgId);
    for (const connection of opened) connection.disconnect();

    const second = await start('After outage');
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ status: 'RUNNING' });
  });

  t('a closed queue is closed once and rebuilt once', async () => {
    // WHY: replacing the queue left the old one open, and two starts on an
    // ended connection each built another one.
    const user = await prisma.user.findFirstOrThrow({
      where: { orgId: org.orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    await retireActiveImports(org.orgId);
    const open = await server.inject({
      method: 'POST',
      url: '/api/v1/migrations/start-csv',
      payload: {
        source: 'CSV',
        entityType: 'company',
        rows: [{ name: 'Open queue' }],
        mappings: { name: 'company.name' },
      },
    });
    expect(open.statusCode).toBe(201);
    await retireActiveImports(org.orgId);
    for (const connection of opened) connection.disconnect();
    const before = opened.length;
    const close = vi.spyOn(Queue.prototype, 'close');
    async function failedJob(name: string) {
      const job = await prisma.migrationJob.create({
        data: {
          orgId: org.orgId,
          userId: user.id,
          source: 'CSV',
          status: 'FAILED',
          totalRows: 1,
          completedAt: new Date(),
          meta: { entityType: 'company', mappings: { name: 'company.name' }, dedupStrategy: 'update' },
        },
      });
      await server.redis.set(`migration:${job.id}:company:rows`, JSON.stringify([{ name }]), 'EX', 3600);
      return job.id;
    }
    const left = await failedJob('Left');
    const right = await failedJob('Right');
    try {
      const [a, b] = await Promise.all([
        server.inject({ method: 'POST', url: `/api/v1/migrations/${left}/retry` }),
        server.inject({ method: 'POST', url: `/api/v1/migrations/${right}/retry` }),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      expect(opened.length).toBe(before + 1);
      expect(close).toHaveBeenCalled();
    } finally {
      close.mockRestore();
    }
  });
});
