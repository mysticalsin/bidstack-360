// Integration tests for territory and routing write boundaries.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let seedUserId: string | null = null;
let restoreAuth: (() => void) | null = null;
const createdTerritoryIds: string[] = [];
const foreignOrgIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('territories');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  const user = await prisma.user.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  seedUserId = user?.id ?? null;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (createdTerritoryIds.length > 0) {
    await prisma.leadRoutingRule.deleteMany({
      where: { assignToTerritoryId: { in: createdTerritoryIds } },
    });
    await prisma.territory.deleteMany({ where: { id: { in: createdTerritoryIds } } });
  }
  if (foreignOrgIds.length > 0) {
    await prisma.org.deleteMany({ where: { id: { in: foreignOrgIds } } });
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId || !seedUserId) {
      throw new Error(
        `[skip] ${name} - DATABASE_URL not reachable, isolated org missing, or isolated user missing`,
      );
    }
    await fn();
  });

async function createForeignUser() {
  const suffix = randomUUID();
  const org = await prisma.org.create({
    data: {
      clerkOrg: `org_territory_foreign_${suffix}`,
      name: 'E2E Foreign Territory Tenant',
    },
  });
  foreignOrgIds.push(org.id);
  return prisma.user.create({
    data: {
      orgId: org.id,
      clerkUser: `user_territory_foreign_${suffix}`,
      email: `territory-foreign-${suffix}@example.com`,
      name: 'Foreign Territory Owner',
      role: 'manager',
    },
  });
}

describe('forecast input validation', () => {
  // WHY: `period` on GET /forecasts has a max(10) guard to prevent ORM
  // LIKE-style DoS via a long query string. Verify it rejects oversized values.
  skipIfNoDb('GET /api/forecasts rejects period longer than 10 chars', async () => {
    const long = 'x'.repeat(11);
    const res = await server.inject({
      method: 'GET',
      url: `/api/forecasts?period=${encodeURIComponent(long)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  skipIfNoDb('GET /api/forecasts accepts a valid period string', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/forecasts?period=2025-01',
    });
    expect([200, 403]).toContain(res.statusCode);
  });
});

describe('forecast owner scoping', () => {
  // WHY: the Forecasts grid lists every owner's rows and edits them inline, so
  // POST /forecasts must write the row's owner — and only if that owner is in
  // the caller's org. Regression guard for the bug where the upsert silently
  // keyed on req.auth.userId, overwriting the editor's own row on every edit.
  skipIfNoDb('POST /api/forecasts writes the target in-tenant owner row', async () => {
    const period = `2099-${randomUUID().slice(0, 2)}`;
    const res = await server.inject({
      method: 'POST',
      url: '/api/forecasts',
      payload: { period, category: 'commit', amountMicros: 1_000_000, ownerId: seedUserId },
    });
    // 201 when the caller holds territories:write (seed admin does); 403 otherwise.
    expect([201, 403]).toContain(res.statusCode);
    if (res.statusCode === 201) {
      const body = res.json() as { ownerId: string };
      expect(body.ownerId).toBe(seedUserId);
      await prisma.forecast.deleteMany({ where: { orgId: orgId!, ownerId: seedUserId!, period } });
    }
  });

  skipIfNoDb('POST /api/forecasts rejects an owner id outside the tenant scope', async () => {
    const foreignUser = await createForeignUser();
    const period = `2099-${randomUUID().slice(0, 2)}`;
    const res = await server.inject({
      method: 'POST',
      url: '/api/forecasts',
      payload: { period, category: 'commit', amountMicros: 2_000_000, ownerId: foreignUser.id },
    });

    expect(res.statusCode).toBe(400);
    const leaked = await prisma.forecast.findFirst({
      where: { ownerId: foreignUser.id, period },
    });
    expect(leaked).toBeNull();
  });

  skipIfNoDb('DELETE /api/forecasts/:id removes the row and 404s on a repeat', async () => {
    const period = `2099-${randomUUID().slice(0, 2)}`;
    const created = await server.inject({
      method: 'POST',
      url: '/api/forecasts',
      payload: { period, category: 'best_case', amountMicros: 500_000 },
    });
    if (created.statusCode === 403) return; // caller lacks territories:write
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    const del1 = await server.inject({ method: 'DELETE', url: `/api/forecasts/${id}` });
    expect(del1.statusCode).toBe(200);
    const del2 = await server.inject({ method: 'DELETE', url: `/api/forecasts/${id}` });
    expect(del2.statusCode).toBe(404);
  });
});

describe('territory routes', () => {
  skipIfNoDb(
    'POST /api/territories creates a territory for an owner in the caller org',
    async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/territories',
        payload: {
          name: `E2E Territory ${randomUUID().slice(0, 8)}`,
          countryCodes: ['US'],
          region: null,
          postalCodes: [],
          ownerId: seedUserId,
          active: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; ownerId: string };
      expect(body.ownerId).toBe(seedUserId);
      createdTerritoryIds.push(body.id);
    },
  );

  skipIfNoDb('POST /api/territories rejects owner ids outside the tenant scope', async () => {
    const foreignUser = await createForeignUser();
    const name = `Cross Tenant Territory ${randomUUID().slice(0, 8)}`;

    const res = await server.inject({
      method: 'POST',
      url: '/api/territories',
      payload: {
        name,
        countryCodes: ['CA'],
        region: null,
        postalCodes: [],
        ownerId: foreignUser.id,
        active: true,
      },
    });

    expect(res.statusCode).toBe(400);
    const leaked = await prisma.territory.findFirst({ where: { name, ownerId: foreignUser.id } });
    expect(leaked).toBeNull();
  });

  skipIfNoDb(
    'POST /api/lead-routing-rules rejects round-robin users outside the tenant scope',
    async () => {
      const foreignUser = await createForeignUser();
      const name = `Cross Tenant Routing ${randomUUID().slice(0, 8)}`;

      const res = await server.inject({
        method: 'POST',
        url: '/api/lead-routing-rules',
        payload: {
          name,
          active: true,
          priority: 10,
          criteria: {},
          assignToUserId: null,
          assignToTerritoryId: null,
          roundRobinTeam: [foreignUser.id],
          roundRobinIndex: 0,
        },
      });

      expect(res.statusCode).toBe(400);
      const leaked = await prisma.leadRoutingRule.findFirst({ where: { name } });
      expect(leaked).toBeNull();
    },
  );
});
