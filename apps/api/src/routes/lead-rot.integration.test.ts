// Integration tests for POST /api/v1/leads/:id/recovery-suggest RBAC gating.
//
// The route reads an org-scoped lead and returns AI-stub recovery plays. It
// was previously open to any authenticated user — gated behind leads:read for
// consistency with every other lead read. Two directions:
//   1. An identity WITHOUT leads:read is rejected (403), nothing leaked.
//   2. An identity WITH leads:read succeeds (200) and gets real plays.
//
// None of the fixed stub-role-header identities (admin, manager/sales-manager,
// read-only/viewer) lack leads:read — the seed matrix grants every role that
// header can select at least read visibility on leads. To exercise the "no
// grant" path for real, the test revokes leads:read from the Read-Only role
// inside this file's throwaway isolated org (dropped in afterAll, so nothing
// else is affected) and drives the header through that de-permissioned role.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { invalidateRbacDecisionCache } from '../lib/rbac-decision-cache.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let leadId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;
const suffix = randomUUID().slice(0, 8);

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
  const iso = await createIsolatedOrg('leadrot');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);

  const lead = await prisma.lead.create({
    data: {
      orgId,
      firstName: 'Rot',
      lastName: `Test ${suffix}`,
      companyName: `Stale Prospect ${suffix}`,
      status: 'new',
      // Far enough in the past that it reads as rotten under every default
      // threshold, so a successful call returns non-empty `plays`.
      statusChangedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  leadId = lead.id;

  // Revoke leads:read from the Read-Only role in THIS isolated org only —
  // gives the 'read-only'/'viewer' stub-role header a real no-grant identity
  // to drive the 403 assertion with.
  const [readOnlyRole, leadsReadPermission] = await Promise.all([
    prisma.role.findFirst({ where: { orgId, name: 'Read-Only' }, select: { id: true } }),
    prisma.permission.findFirst({ where: { key: 'leads:read' }, select: { id: true } }),
  ]);
  if (readOnlyRole && leadsReadPermission) {
    await prisma.rolePermission.deleteMany({
      where: { orgId, roleId: readOnlyRole.id, permissionId: leadsReadPermission.id },
    });
    invalidateRbacDecisionCache(orgId);
  }

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
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

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!orgId && !!leadId);

describe('POST /leads/:id/recovery-suggest RBAC', () => {
  skipIfNoDb('403s for an identity without leads:read; nothing about the lead leaks', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/leads/${leadId}/recovery-suggest`,
      headers: { 'x-bidstack-e2e-role': 'read-only' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).not.toHaveProperty('plays');
  });

  skipIfNoDb('200s with recovery plays for an identity holding leads:read', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/leads/${leadId}/recovery-suggest`,
      headers: { 'x-bidstack-e2e-role': 'manager' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { leadId: string; isRotten: boolean; plays: unknown[] };
    expect(body.leadId).toBe(leadId);
    expect(body.isRotten).toBe(true);
    expect(body.plays.length).toBeGreaterThan(0);
  });
});
