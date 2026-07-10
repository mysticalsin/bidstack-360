// Integration tests for /api/accounts/* and /api/companies/:id/tier.

import { createHash } from 'node:crypto';

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
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
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
  const iso = await createIsolatedOrg('accounts');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
});

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId);

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
    const body = res.json() as {
      source: 'auto' | 'curated';
      items: Array<{ totalValue: number; topAccountRank: number }>;
    };
    expect(Array.isArray(body.items)).toBe(true);
    if (body.items.length > 1) {
      if (body.source === 'curated') {
        expect(body.items[0].topAccountRank).toBeLessThanOrEqual(body.items[1].topAccountRank);
      } else {
        expect(body.items[0].totalValue).toBeGreaterThanOrEqual(body.items[1].totalValue);
      }
    }
  });

  skipIfNoDb('GET /api/accounts/top supports search filter', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/accounts/top?search=Mantu&limit=5',
    });
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
      console.warn('[skip] no isolated org');
      return;
    }
    // Pick a NON-key company so PATCH→key is a real standard→key transition;
    // keyAccountSince is only stamped on that transition (accounts.ts), so
    // promoting an already-key company would leave it null and falsely fail.
    const company = await prisma.company.findFirst({
      where: { orgId, deletedAt: null, tier: { not: 'key' } },
      orderBy: { createdAt: 'asc' },
    });
    if (!company) {
      console.warn('[skip] no non-key companies to tier');
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
      console.warn('[skip] no isolated org');
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

  skipIfNoDb('PUT /api/accounts/top-list without settings:write is 403', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: '/api/accounts/top-list',
      headers: { 'x-bidstack-e2e-role': 'manager' },
      payload: { companyIds: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  skipIfNoDb(
    'PUT /api/accounts/top-list rejects API keys even with settings write scope',
    async () => {
      if (!orgId) {
        console.warn('[skip] no isolated org');
        return;
      }
      // API keys can carry broad read/write scopes, but global curation still
      // requires a human DB-backed admin for audit integrity.
      const rawKey = `itest_settings_${Date.now()}`;
      const apiKey = await prisma.apiKey.create({
        data: {
          orgId,
          name: 'integration-test settings key',
          hashedKey: createHash('sha256').update(rawKey).digest('hex'),
          prefix: rawKey.slice(0, 8),
          scopes: ['read', 'write'],
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
    },
  );
});
