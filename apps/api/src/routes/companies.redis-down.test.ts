// Live repro on main 40b13242ebf18d715b67bb6133a9774bbd7d0c78, Redis at
// redis://127.0.0.1:6399 (connection refused): POST /api/v1/companies wrote
// the company row and then returned no HTTP status within 45.038s. The
// awaited account-intel producer uses ioredis with enableOfflineQueue: true
// and maxRetriesPerRequest: null, so Queue.add() never settles. This test
// fails until that wait is bounded.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import type { buildServer as BuildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

/** Well under the 45s live hang, and above a Postgres insert on a healthy DB. */
const CREATE_DEADLINE_MS = 3_000;

let server: Awaited<ReturnType<typeof BuildServer>> | undefined;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let requestHung = false;
const createdCompanyIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('redis-down-create');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const { buildServer } = await import('../server.js');
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (createdCompanyIds.length > 0) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } }).catch(() => undefined);
  }
  // A still-pending create keeps Fastify's close waiting on the handler.
  // Bound this hook so the red run reports the assertion instead of the hook.
  if (server && !requestHung) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId && !!server);

const bareCompany = (name: string) => ({
  name,
  legalName: null,
  domain: null,
  industry: null,
  employeeCount: null,
  countryCode: null,
  address: null,
  billingEmail: null,
  taxId: null,
  logoUrl: null,
  website: null,
});

skipIfNoDb('company create with Redis down resolves within 3 seconds', async () => {
  const previousRedis = process.env.REDIS_URL;
  const previousFlag = process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS;
  // Closed port. The queue client reads REDIS_URL when it is first constructed.
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS = 'true';
  const suffix = randomUUID().slice(0, 8);
  try {
    const pending = server!.inject({
      method: 'POST',
      url: '/api/v1/companies',
      payload: { ...bareCompany(`Redis Down ${suffix}`), tier: 'standard' },
    });
    const outcome = await Promise.race([
      pending.then((res) => ({ kind: 'response' as const, res })),
      new Promise<{ kind: 'hung' }>((resolve) => {
        setTimeout(() => resolve({ kind: 'hung' }), CREATE_DEADLINE_MS);
      }),
    ]);
    if (outcome.kind === 'hung') requestHung = true;
    // WHY: the company row is a Postgres write. Redis is only the async
    // enrichment enqueue. A refused Redis connection must not hold the
    // response open until the client gives up.
    expect(outcome.kind, 'company create stayed pending past the Redis bound').toBe('response');
    if (outcome.kind === 'response') {
      expect(outcome.res.statusCode).toBe(201);
      createdCompanyIds.push(outcome.res.json<{ id: string }>().id);
    }
  } finally {
    if (previousRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedis;
    if (previousFlag === undefined) delete process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS;
    else process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS = previousFlag;
  }
});
