import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId = '';
let restoreAuth: (() => void) | null = null;

// Hermetic: bind stub auth to a freshly-seeded isolated org rather than the
// shared seed tenant. This test reads org-wide aggregates through the default
// stub identity, so a concurrent suite mutating that shared seed org (roles, rows)
// could flip its status/counts — a real full-run flake. Its own org is immune.
beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('crm-summary');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
});

const failIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('crm summary routes', () => {
  failIfNoDb('GET /api/crm/summary returns bounded activity and counts', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/summary?limit=3' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.companies).toEqual(expect.any(Number));
    expect(body.contacts).toEqual(expect.any(Number));
    expect(body.pipelineValue).toEqual(expect.any(Number));
    expect(body.recentActivity).toEqual(expect.any(Array));
    expect(body.recentActivity.length).toBeLessThanOrEqual(3);
  });

  failIfNoDb('GET /api/crm/summary rejects invalid limits', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/crm/summary?limit=0' });
    expect(res.statusCode).toBe(400);
  });
});
