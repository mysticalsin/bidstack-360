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

  t('a row delete that throws does not turn cleanup into 500', async () => {
    // WHY: abandon removes the pending job, then deletes the Redis key. A
    // throw from that delete used to replace the 409 and the client saw 500.
    // This file has its own server, so the assertion does not spend the
    // start route's rate limit in the queue file.
    await retireActiveImports(org.orgId);
    const del = vi.spyOn(server.redis, 'del').mockRejectedValue(new Error('Connection is closed.'));
    const add = vi.spyOn(Queue.prototype, 'addBulk').mockRejectedValue(new Error('queue down'));
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name: 'Cleanup' }],
          mappings: { name: 'company.name' },
        },
      });
      expect(res.statusCode).not.toBe(500);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ message: 'The import could not be queued. Try again.' });
    } finally {
      del.mockRestore();
      add.mockRestore();
    }
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
      // Tony's rule: only block starting the same import twice. Same import is
      // org + source + sha256 of the rows. HubSpot is excluded because
      // file_hash is null. Left and Right are two different failed jobs with
      // different row payloads, so both retries return 200. This is not an
      // idempotent resume of one job, and it is not a second start of the
      // same import. That second start is still 409.
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(opened.length).toBe(before + 1);
      expect(close).toHaveBeenCalled();
    } finally {
      close.mockRestore();
    }
  });
});
