// Integration tests for /api/accounts/* and /api/companies/:id/tier.

import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;

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
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable) {
      throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    }
    await fn();
  });

describe('accounts routes', () => {
  skipIfNoDb('GET /api/accounts/key returns key accounts', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/accounts/key' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    // Seed may or may not have key-tier companies; just verify shape
    if (body.items.length > 0) {
      expect(body.items[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        tier: 'key',
        totalValue: expect.any(Number),
        openDeals: expect.any(Number),
        contactCount: expect.any(Number),
      });
    }
  });

  skipIfNoDb('GET /api/accounts/top returns ranked accounts', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/accounts/top?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    if (body.items.length > 1) {
      // Verify descending sort by totalValue
      expect(body.items[0].totalValue).toBeGreaterThanOrEqual(body.items[1].totalValue);
    }
  });

  skipIfNoDb('GET /api/accounts/top supports search filter', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/accounts/top?search=Mantu&limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // May be empty if no Mantu company in seed; just verify 200
    expect(Array.isArray(body.items)).toBe(true);
  });

  skipIfNoDb('GET /api/accounts/industries returns distinct list', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/accounts/industries' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  skipIfNoDb('PATCH /api/companies/:id/tier updates tier', async () => {
    if (!orgId) {
      console.warn('[skip] no seed org');
      return;
    }
    const company = await prisma.company.findFirst({
      where: { orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!company) {
      console.warn('[skip] no companies to tier');
      return;
    }

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/companies/${company.id}/tier`,
      payload: { tier: 'key', keyAccountNotes: 'Promoted during audit' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tier).toBe('key');
    expect(body.keyAccountNotes).toBe('Promoted during audit');
    expect(body.keyAccountSince).toBeTruthy();

    // Restore
    await server.inject({
      method: 'PATCH',
      url: `/api/companies/${company.id}/tier`,
      payload: { tier: company.tier ?? 'standard' },
    });
  });

  skipIfNoDb('PATCH /api/companies/:id/tier returns 404 for unknown id', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/companies/11111111-2222-3333-4444-555555555555/tier',
      payload: { tier: 'key' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('top accounts curation', () => {
  // WHY: the curated top-10 must come back in the admin's exact order with
  // source='curated' (not re-sorted by pipeline value), and clearing the list
  // must restore the auto leaderboard — that is the whole M5 contract.
  skipIfNoDb('PUT /api/accounts/top-list then GET returns curated order', async () => {
    if (!orgId) {
      console.warn('[skip] no seed org');
      return;
    }
    const companies = await prisma.company.findMany({
      where: { orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 3,
      select: { id: true },
    });
    if (companies.length < 2) {
      console.warn('[skip] not enough companies to curate');
      return;
    }
    // Deliberately NOT insertion/value order: rank must follow body order.
    const curatedIds = [companies[1]!.id, companies[0]!.id];

    try {
      const put = await server.inject({
        method: 'PUT',
        url: '/api/accounts/top-list',
        payload: { companyIds: curatedIds },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().companyIds).toEqual(curatedIds);

      const res = await server.inject({ method: 'GET', url: '/api/accounts/top?limit=10' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.source).toBe('curated');
      expect(body.items.map((i: { id: string }) => i.id)).toEqual(curatedIds);
      expect(body.items[0].topAccountRank).toBe(1);
      expect(body.items[1].topAccountRank).toBe(2);
    } finally {
      // Restore auto mode regardless of assertion failures above.
      await server.inject({
        method: 'PUT',
        url: '/api/accounts/top-list',
        payload: { companyIds: [] },
      });
    }

    const after = await server.inject({ method: 'GET', url: '/api/accounts/top?limit=10' });
    expect(after.statusCode).toBe(200);
    expect(after.json().source).toBe('auto');
  });

  skipIfNoDb('PUT /api/accounts/top-list rejects company ids outside the org', async () => {
    // Unknown/foreign-org uuid must fail validation, not silently rank nothing.
    const res = await server.inject({
      method: 'PUT',
      url: '/api/accounts/top-list',
      payload: { companyIds: ['11111111-2222-3333-4444-555555555555'] },
    });
    expect(res.statusCode).toBe(400);
  });

  skipIfNoDb('PUT /api/accounts/top-list without accounts:write is 403', async () => {
    if (!orgId) {
      console.warn('[skip] no seed org');
      return;
    }
    // A read-only API key exercises the requirePermission('accounts:write')
    // gate without admin claims — curation must stay admin-only.
    const rawKey = `itest_readonly_${Date.now()}`;
    const apiKey = await prisma.apiKey.create({
      data: {
        orgId,
        name: 'integration-test read-only key',
        hashedKey: createHash('sha256').update(rawKey).digest('hex'),
        prefix: rawKey.slice(0, 8),
        scopes: ['read'],
      },
    });
    try {
      const res = await server.inject({
        method: 'PUT',
        url: '/api/accounts/top-list',
        headers: { 'x-api-key': rawKey },
        payload: { companyIds: [] },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await prisma.apiKey.delete({ where: { id: apiKey.id } });
    }
  });
});
