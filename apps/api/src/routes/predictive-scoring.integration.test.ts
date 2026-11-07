// Integration: POST /admin/predictive/retrain (Predictive admin page buttons).
// Needs Postgres and Redis (the route enqueues a BullMQ job).
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  type IsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let org: IsolatedOrg | null = null;
let restoreAuth: (() => void) | undefined;
let previousStubRoleHeader: string | undefined;

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('predictive');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
}, 60_000);

const t = makeSkipIfNoDb(() => dbReachable && !!org);

describe('predictive retrain', () => {
  t('queues a retrain for one entity type', async () => {
    for (const entityType of ['lead', 'opportunity']) {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/predictive/retrain',
        payload: { entityType },
      });
      expect(res.statusCode, entityType).toBe(202);
      expect((res.json() as { jobId: string | null }).jobId).toBeTruthy();
    }
  });

  t('queues both models when no entity type is given', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/predictive/retrain',
      payload: {},
    });
    expect(res.statusCode).toBe(202);
  });

  t('rejects an unknown entity type and a non-admin caller', async () => {
    const bad = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/predictive/retrain',
      payload: { entityType: 'company' },
    });
    expect(bad.statusCode).toBe(400);
    const denied = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/predictive/retrain',
      headers: { 'x-bidstack-e2e-role': 'sales-manager' },
      payload: { entityType: 'lead' },
    });
    expect(denied.statusCode).toBe(403);
  });
});
