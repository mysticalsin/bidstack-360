// WHY: ten starts a minute is per user. The eleventh from that user is 429.
// Someone else in the same org still has their own bucket. Start answers 201.

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: FastifyInstance;
let org: IsolatedOrg;
let restore: (() => void) | undefined;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  org = await createIsolatedOrg('csv-limit');
  // An older override admin must not become this org's default session.
  await prisma.user.updateMany({
    where: { email: 'e2e-admin@bidstack.local' },
    data: { createdAt: new Date() },
  });
  restore = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  restore?.();
  if (server) await server.close();
  if (org) await dropIsolatedOrg(org.orgId);
});

const t = makeSkipIfNoDb(() => dbReachable);

describe('csv start rate limit', () => {
  t('the 11th start in a minute is 429 and another user in the org still starts', async () => {
    const payload = (name: string) => ({
      source: 'CSV' as const,
      entityType: 'company',
      rows: [{ name }],
      mappings: { name: 'company.name' },
    });

    for (let n = 1; n <= 10; n += 1) {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: payload(`Same user ${n}`),
      });
      expect(res.statusCode).toBe(201);
    }

    const blocked = await server.inject({
      method: 'POST',
      url: '/api/v1/migrations/start-csv',
      payload: payload('Same user 11'),
    });
    expect(blocked.statusCode).toBe(429);

    const other = await server.inject({
      method: 'POST',
      url: '/api/v1/migrations/start-csv',
      headers: { 'x-bidstack-e2e-role': 'admin' },
      payload: payload('Other user'),
    });
    expect(other.statusCode).toBe(201);
  });
});
