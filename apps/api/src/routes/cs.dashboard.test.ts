import { randomUUID } from 'node:crypto';

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

  skipIfNoDb('counts a critical account past the first fifty ids', async () => {
    // WHY: the buckets used the first 50 account ids. A later critical account
    // disappeared, and the preview was those ids rather than the newest scores.
    const before = await server.inject({ method: 'GET', url: '/api/v1/cs/dashboard' });
    expect(before.statusCode).toBe(200);
    const baseline = before.json() as {
      accountsByHealth: { healthy: number; atRisk: number; critical: number };
    };
    const stamp = Date.now();
    const scopedId = (prefix: '0' | 'f') => `${prefix}${randomUUID().slice(1)}`;
    const healthyIds = Array.from({ length: 50 }, () => scopedId('0'));
    const criticalId = scopedId('f');
    await prisma.company.createMany({
      data: [
        ...healthyIds.map((id, index) => ({
          id,
          orgId,
          name: `Healthy filler ${stamp}-${index}`,
        })),
        { id: criticalId, orgId, name: `Critical late ${stamp}` },
      ],
    });
    await prisma.healthScore.createMany({
      data: [
        ...healthyIds.map((accountId) => ({
          orgId,
          accountId,
          score: 90,
          trend: 'STABLE' as const,
          capturedAt: new Date('2026-01-01T00:00:00.000Z'),
        })),
        {
          orgId,
          accountId: criticalId,
          score: 20,
          trend: 'DECLINING' as const,
          capturedAt: new Date('2026-12-01T00:00:00.000Z'),
        },
      ],
    });

    const after = await server.inject({ method: 'GET', url: '/api/v1/cs/dashboard' });
    expect(after.statusCode).toBe(200);
    const body = after.json() as {
      accountsByHealth: { healthy: number; atRisk: number; critical: number };
      latestHealthScores: Array<{ accountId: string; score: number }>;
    };
    expect(body.accountsByHealth).toEqual({
      healthy: baseline.accountsByHealth.healthy + 50,
      atRisk: baseline.accountsByHealth.atRisk,
      critical: baseline.accountsByHealth.critical + 1,
    });
    expect(body.latestHealthScores[0]).toMatchObject({ accountId: criticalId, score: 20 });
    expect(body.latestHealthScores).toHaveLength(10);
  });
});
