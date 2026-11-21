// Live repro on main 40b13242ebf18d715b67bb6133a9774bbd7d0c78, Redis at
// redis://127.0.0.1:6399 (connection refused): POST /api/v1/companies wrote
// the company row and then returned no HTTP status within 45.038s. The
// account-intel producer queued the BullMQ command forever
// (enableOfflineQueue + maxRetriesPerRequest null). The create must now
// answer inside CREATE_DEADLINE_MS with the company committed and enrichment
// marked failed when Redis is down, or queued when Redis is up.
// Named *.integration.test.ts because the unit CI job has no Postgres and
// excludes that glob. makeSkipIfNoDb throws when the database is unreachable,
// so this file must run only in the integration job.
import { randomUUID } from 'node:crypto';

import IORedis from 'ioredis';
import { afterAll, beforeAll, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import type { buildServer as BuildServer } from '../server.js';
import { __resetAccountIntelQueueForTest } from '../queues/account-intel.js';
import { __resetCompanyTechDetectQueueForTest } from '../queues/company-tech-detect.js';
import { ENRICHMENT_FAILED_MESSAGE, ENRICHMENT_QUEUED_MESSAGE } from '../queues/producer-redis.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

/** Well under the 45s live hang, and above a Postgres insert plus the 1s producer budget. */
const CREATE_DEADLINE_MS = 3_000;

let server: Awaited<ReturnType<typeof BuildServer>> | undefined;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
const createdCompanyIds: string[] = [];
const redisUrlAtBoot = process.env.REDIS_URL;

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
  await __resetAccountIntelQueueForTest().catch(() => undefined);
  await __resetCompanyTechDetectQueueForTest().catch(() => undefined);
  if (createdCompanyIds.length > 0) {
    await prisma.intelSourceRun.deleteMany({ where: { companyId: { in: createdCompanyIds } } }).catch(() => undefined);
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } }).catch(() => undefined);
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (redisUrlAtBoot === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = redisUrlAtBoot;
  delete process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS;
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

async function redisReplies(): Promise<boolean> {
  const client = new IORedis(redisUrlAtBoot ?? 'redis://127.0.0.1:6379', {
    connectTimeout: 500,
    commandTimeout: 500,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

async function postCompany(name: string) {
  const pending = server!.inject({
    method: 'POST',
    url: '/api/v1/companies',
    payload: { ...bareCompany(name), tier: 'standard' },
  });
  const outcome = await Promise.race([
    pending.then((res) => ({ kind: 'response' as const, res })),
    new Promise<{ kind: 'hung' }>((resolve) => {
      setTimeout(() => resolve({ kind: 'hung' }), CREATE_DEADLINE_MS);
    }),
  ]);
  // WHY: the company row is a Postgres write. Redis is only the async
  // enrichment enqueue. A refused Redis connection must not hold the response.
  expect(outcome.kind, 'company create stayed pending past the Redis bound').toBe('response');
  if (outcome.kind !== 'response') throw new Error('company create hung');
  return outcome.res;
}

skipIfNoDb('company create with Redis down resolves within 3 seconds', async () => {
  const previousRedis = process.env.REDIS_URL;
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS = 'true';
  await __resetAccountIntelQueueForTest();
  await __resetCompanyTechDetectQueueForTest();
  const suffix = randomUUID().slice(0, 8);
  try {
    const res = await postCompany(`Redis Down ${suffix}`);
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; enrichment: { status: string; message: string } }>();
    createdCompanyIds.push(body.id);
    expect(body.enrichment).toEqual({ status: 'failed', message: ENRICHMENT_FAILED_MESSAGE });
    expect(await prisma.intelSourceRun.count({ where: { orgId: orgId!, companyId: body.id } })).toBe(0);
    expect(await prisma.company.count({ where: { id: body.id, orgId: orgId! } })).toBe(1);
  } finally {
    if (previousRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedis;
  }
});

skipIfNoDb('company create with Redis up queues enrichment', async () => {
  if (!(await redisReplies())) {
    throw new Error('REDIS_URL is not answering; the up-path create test cannot run');
  }
  process.env.REDIS_URL = redisUrlAtBoot ?? 'redis://127.0.0.1:6379';
  process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS = 'true';
  await __resetAccountIntelQueueForTest();
  await __resetCompanyTechDetectQueueForTest();
  const suffix = randomUUID().slice(0, 8);
  const res = await postCompany(`Redis Up ${suffix}`);
  expect(res.statusCode).toBe(201);
  const body = res.json<{ id: string; enrichment: { status: string; message: string } }>();
  createdCompanyIds.push(body.id);
  expect(body.enrichment).toEqual({ status: 'queued', message: ENRICHMENT_QUEUED_MESSAGE });
  const runs = await prisma.intelSourceRun.findMany({
    where: { orgId: orgId!, companyId: body.id },
    select: { source: true, status: true },
  });
  expect(runs.map((row) => `${row.source}:${row.status}`).sort()).toEqual([
    'financials:queued',
    'registry:queued',
  ]);
});
