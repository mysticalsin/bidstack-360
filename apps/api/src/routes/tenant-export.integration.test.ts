// Integration tests for the GDPR Art. 20 tenant export routes.
// Pattern: users.roles.integration.test.ts — buildServer + inject against the
// seed org (org_seed_mantu); role switching via the x-bidstack-e2e-role header.
//
// WHY these assertions matter:
//   - an org-admin must be able to REQUEST an export (Art. 20 right);
//   - a non-admin (read-only) must be REFUSED (settings:write gate);
//   - a path :orgId that is not the caller's org must be REFUSED (no
//     cross-tenant export — the core multi-tenancy invariant of this product);
//   - a second request while one is in flight must NOT start a second
//     full-tenant scan (single-flight) — it returns the existing pending one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
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
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (!orgId) return;
  // Start from a clean slate so single-flight assertions are deterministic.
  await prisma.tenantExport.deleteMany({ where: { orgId } });
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.tenantExport.deleteMany({ where: { orgId } });
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId) throw new Error(`[skip] ${name} — DB/seed org unavailable`);
    await fn();
  });

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
});
