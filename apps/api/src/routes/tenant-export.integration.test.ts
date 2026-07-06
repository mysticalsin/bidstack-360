// Integration tests for the GDPR Art. 20 tenant export routes.
// Pattern: users.roles.integration.test.ts — buildServer + inject against the
// isolated org; role switching via the x-bidstack-e2e-role header.
//
// WHY these assertions matter:
//   - an org-admin must be able to REQUEST an export (Art. 20 right);
//   - a non-admin (read-only) must be REFUSED (settings:write gate);
//   - a path :orgId that is not the caller's org must be REFUSED (no
//     cross-tenant export — the core multi-tenancy invariant of this product);
//   - a second request while one is in flight must NOT start a second
//     full-tenant scan (single-flight) — it returns the existing pending one.
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
const createdExportIds: string[] = [];

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
  const iso = await createIsolatedOrg('tenant-export');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  // Start from a clean slate so single-flight assertions are deterministic.
  await prisma.tenantExport.deleteMany({ where: { orgId } });
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.tenantExport.deleteMany({ where: { orgId } });
  }
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('tenant export routes (GDPR Art. 20)', () => {
  t('admin can request an export → 201 + a pending TenantExport row', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/export`,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; status: string; orgId: string; downloadUrl: null };
    expect(body.orgId).toBe(orgId);
    expect(body.status).toBe('pending');
    expect(body.downloadUrl).toBeNull();
    createdExportIds.push(body.id);

    const row = await prisma.tenantExport.findUnique({ where: { id: body.id } });
    expect(row).not.toBeNull();
    expect(row?.status).toBe('pending');
    expect(row?.requestedById).toBeTruthy();
  });

  t('single-flight: a second request returns the existing pending export (200)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/export`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; status: string };
    expect(body.status).toBe('pending');
    // Same row as the first request — no duplicate scan started.
    expect(createdExportIds).toContain(body.id);

    const count = await prisma.tenantExport.count({
      where: { orgId: orgId!, status: { in: ['pending', 'running'] } },
    });
    expect(count).toBe(1);
  });

  t('non-admin (read-only) is refused with 403', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/export`,
      headers: { 'x-bidstack-e2e-role': 'read-only' },
    });
    expect(res.statusCode).toBe(403);
  });

  t('cross-tenant :orgId is refused with 403', async () => {
    const otherOrgId = '00000000-0000-4000-8000-000000000000';
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${otherOrgId}/export`,
    });
    expect(res.statusCode).toBe(403);
  });

  t('admin can list this org exports and read a single export status', async () => {
    const list = await server.inject({ method: 'GET', url: `/api/v1/orgs/${orgId}/exports` });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { items: { id: string; status: string }[] };
    expect(listBody.items.length).toBeGreaterThan(0);

    const id = listBody.items[0]!.id;
    const single = await server.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/exports/${id}`,
    });
    expect(single.statusCode).toBe(200);
    expect((single.json() as { id: string }).id).toBe(id);
  });

  t('GET a non-existent export id returns 404', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/orgs/${orgId}/exports/11111111-1111-4111-8111-111111111111`,
    });
    expect(res.statusCode).toBe(404);
  });

  t('listing another org exports is refused with 403', async () => {
    const otherOrgId = '00000000-0000-4000-8000-000000000000';
    const res = await server.inject({ method: 'GET', url: `/api/v1/orgs/${otherOrgId}/exports` });
    expect(res.statusCode).toBe(403);
  });

  // WHY: createdAt is not unique — under bulk creation (or two exports requested
  // in the same millisecond) rows tie on the list's keyset column. Ordering by
  // createdAt ALONE leaves the ties in an unspecified heap order, which is not
  // stable across the id-cursor + skip:1 keyset walk — a tie straddling a page
  // boundary can be silently dropped from the next page. An org-admin auditing
  // their export history would then see an incomplete list (a compliance gap).
  //
  // The regression guard is the compound orderBy's DETERMINISTIC total ordering:
  // with `[{createdAt},{id}]` the tie group comes back in strict id-desc order;
  // with the old bare `{createdAt}` sort it comes back in heap/insertion order
  // (verified: not id-sorted). This assertion fails against the pre-fix route and
  // passes against the fixed one, AND the two-page walk proves completeness.
  t('orders createdAt ties by a total (id) key and pages them exactly once', async () => {
    // Reset to a clean slate so the list holds exactly the tied rows and the
    // boundary is deterministic (this route has no filter to isolate on).
    await prisma.tenantExport.deleteMany({ where: { orgId: orgId! } });
    const user = await prisma.user.findFirst({
      where: { orgId: orgId! },
      select: { id: true },
    });
    expect(user).not.toBeNull();
    const tiedAt = new Date('2031-04-04T10:00:00.000Z');
    await prisma.tenantExport.createMany({
      data: [0, 1, 2, 3, 4].map(() => ({
        orgId: orgId!,
        requestedById: user!.id,
        status: 'pending' as const,
        createdAt: tiedAt,
      })),
    });
    const seeded = await prisma.tenantExport.findMany({
      where: { orgId: orgId!, deletedAt: null },
      select: { id: true },
    });
    const seededIdsDesc = seeded.map((r) => r.id).sort().reverse();

    // Walk the whole tie group two-at-a-time through the id-cursor keyset.
    const collected: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const url =
        `/api/v1/orgs/${orgId}/exports?limit=2` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const res = await server.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ id: string }>; nextCursor: string | null };
      for (const row of body.items) collected.push(row.id);
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    // Completeness: every tied row returned exactly once across the page walk.
    expect(collected).toHaveLength(5);
    expect(new Set(collected).size).toBe(5);
    // Total ordering: the tie group is returned in strict id-desc order. A bare
    // `{ createdAt: 'desc' }` sort returns heap order here (NOT id-sorted), so
    // this fails without the compound (createdAt, id) tiebreaker.
    expect(collected).toEqual(seededIdsDesc);
  });
});
