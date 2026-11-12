// The migrations queue keeps its own Redis connection. After that connection
// is closed, the next start has to bring it back. A process restart is not
// required.

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
    for (const connection of opened) connection.disconnect();

    const second = await start('After outage');
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ status: 'RUNNING' });
  });
});
