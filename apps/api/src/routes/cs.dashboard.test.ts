import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId = '';
let restoreAuth: (() => void) | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('cs-dash');
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

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable);

describe('customer-success dashboard health', () => {
  skipIfNoDb('uses the latest score and does not call one snapshot stable', async () => {
    // WHY: distinct kept an older row of 90, so a current 40 still looked healthy.
    const dropped = await prisma.company.create({
      data: { orgId, name: `Dropped ${Date.now()}` },
    });
    const firstOnly = await prisma.company.create({
      data: { orgId, name: `First only ${Date.now()}` },
    });
    await prisma.healthScore.createMany({
      data: [
        {
          orgId,
          accountId: dropped.id,
          score: 90,
          trend: 'STABLE',
          capturedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          orgId,
          accountId: dropped.id,
          score: 40,
          trend: 'DECLINING',
          capturedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
        {
          orgId,
          accountId: firstOnly.id,
          score: 80,
          trend: 'STABLE',
          capturedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    });

    const res = await server.inject({ method: 'GET', url: '/api/v1/cs/dashboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      accountsByHealth: { healthy: number; atRisk: number; critical: number };
      latestHealthScores: Array<{ accountId: string; score: number; trend: string | null }>;
    };
    const byId = new Map(body.latestHealthScores.map((row) => [row.accountId, row]));
    expect(byId.get(dropped.id)).toMatchObject({ score: 40, trend: 'DECLINING' });
    expect(byId.get(firstOnly.id)).toMatchObject({ score: 80, trend: null });
    expect(body.accountsByHealth).toEqual({ healthy: 1, atRisk: 0, critical: 1 });
  });
});
