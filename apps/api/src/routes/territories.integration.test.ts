// Integration tests for territory and routing write boundaries.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let seedUserId: string | null = null;
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
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (!orgId) return;

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
    await prisma.leadRoutingRule.deleteMany({ where: { assignToTerritoryId: { in: createdTerritoryIds } } });
    await prisma.territory.deleteMany({ where: { id: { in: createdTerritoryIds } } });
  }
  if (foreignOrgIds.length > 0) {
    await prisma.org.deleteMany({ where: { id: { in: foreignOrgIds } } });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId || !seedUserId) {
      throw new Error(`[skip] ${name} - DATABASE_URL not reachable, seed org missing, or seed user missing`);
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

describe('territory routes', () => {
  skipIfNoDb('POST /api/territories creates a territory for an owner in the caller org', async () => {
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
  });

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

  skipIfNoDb('POST /api/lead-routing-rules rejects round-robin users outside the tenant scope', async () => {
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
  });
});
