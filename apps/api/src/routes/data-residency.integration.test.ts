// Integration tests for the per-org data residency setting.
//
// WHY: the region tag decides which storage bucket an org's exports land in
// once enforcement is on, so it must be admin-only, validated, persisted on
// org_settings and recorded in the audit log.
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
  const iso = await createIsolatedOrg('residency');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('data residency setting', () => {
  t('starts unpinned and reports enforcement state', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/org-settings/data-residency' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { region: string | null; enforced: boolean; regionalStorage: boolean };
    expect(body.region).toBeNull();
    expect(typeof body.enforced).toBe('boolean');
    expect(typeof body.regionalStorage).toBe('boolean');
  });

  t('admin pins the org to the EU: stored on org_settings and audited', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: '/api/v1/org-settings/data-residency',
      payload: { region: 'eu' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { region: string }).region).toBe('eu');
    const row = await prisma.orgSettings.findFirst({ where: { orgId: orgId! } });
    expect(row?.dataRegion).toBe('eu');
    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'org_settings.data_residency.update' },
    });
    expect(audit).not.toBeNull();

    const read = await server.inject({ method: 'GET', url: '/api/v1/org-settings/data-residency' });
    expect((read.json() as { region: string }).region).toBe('eu');
  });

  t('rejects an unknown region (400) and a non-admin (403)', async () => {
    const bad = await server.inject({
      method: 'PUT',
      url: '/api/v1/org-settings/data-residency',
      payload: { region: 'mars' },
    });
    expect(bad.statusCode).toBe(400);
    const denied = await server.inject({
      method: 'PUT',
      url: '/api/v1/org-settings/data-residency',
      headers: { 'x-bidstack-e2e-role': 'read-only' },
      payload: { region: 'us' },
    });
    expect(denied.statusCode).toBe(403);
  });
});
