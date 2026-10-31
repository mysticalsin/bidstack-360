/**
 * Secure-by-default read gates (issue #28 and the route-authz census).
 *
 * Real RBAC decisions against the seeded system roles: a role holding the
 * resource's :read permission gets through, and the same role with that one
 * grant revoked gets 403.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

let server: FastifyInstance;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousRoleHeader: string | undefined;

beforeAll(async () => {
  previousRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  const org = await createIsolatedOrg('rbac-read-gates');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (previousRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousRoleHeader;
  if (orgId) await dropIsolatedOrg(orgId);
});

function get(url: string, role: string) {
  return server.inject({ method: 'GET', url, headers: { 'x-bidstack-e2e-role': role } });
}

/**
 * Soft-revoke one grant from a system role in the isolated org for the length
 * of `fn`. Since the 2026-10-31 role-read restore, every stub header role holds
 * most :read keys, so "a role without the key" is produced by revoking it
 * rather than by picking a role the seed happens to leave out.
 */
async function withoutGrant<T>(roleName: string, key: string, fn: () => Promise<T>): Promise<T> {
  if (!orgId) throw new Error('isolated org missing');
  const where = {
    orgId,
    deletedAt: null,
    role: { orgId, name: roleName },
    permission: { key },
  };
  const ids = (await prisma.rolePermission.findMany({ where, select: { roleId: true, permissionId: true }, take: 5 }))
    .map((r) => ({ roleId: r.roleId, permissionId: r.permissionId }));
  expect(ids.length, `${roleName} should hold ${key} before the revoke`).toBe(1);
  await prisma.rolePermission.updateMany({ where: { OR: ids }, data: { deletedAt: new Date() } });
  clearRbacDecisionCacheForTest();
  try {
    return await fn();
  } finally {
    // Raw SQL on purpose: the soft-delete middleware adds deleted_at IS NULL
    // to every client query, so updateMany could never find the tombstones.
    for (const { roleId, permissionId } of ids) {
      await prisma.$executeRaw`UPDATE role_permissions SET deleted_at = NULL WHERE role_id = ${roleId}::uuid AND permission_id = ${permissionId}::uuid`;
    }
    clearRbacDecisionCacheForTest();
  }
}

// [url, stub header role, its system role name, the :read key that gates the url]
const CASES: Array<[string, string, string, string]> = [
  ['/api/v1/leads', 'sdr', 'SDR', 'leads:read'], // #28
  ['/api/v1/opportunities', 'account-executive', 'Account Executive', 'opportunities:read'],
  ['/api/v1/opportunities/count', 'customer-success', 'Customer Success', 'opportunities:read'],
  ['/api/v1/opportunities/export', 'account-executive', 'Account Executive', 'opportunities:read'],
  ['/api/v1/forecasts/projection', 'account-executive', 'Account Executive', 'opportunities:read'],
  ['/api/v1/proposals', 'account-executive', 'Account Executive', 'proposals:read'],
  ['/api/v1/dashboards', 'customer-success', 'Customer Success', 'reports:read'],
  ['/api/v1/service-cases', 'customer-success', 'Customer Success', 'service-desk:read'],
  ['/api/v1/document-templates', 'read-only', 'Read-Only', 'documents:read'],
  ['/api/v1/migrations', 'read-only', 'Read-Only', 'migrations:read'],
  ['/api/v1/territories/analytics', 'sales-manager', 'Sales Manager', 'territories:read'],
  ['/api/v1/integrations/webhooks', 'read-only', 'Read-Only', 'integrations:read'],
];

describe('secure-by-default read gates', () => {
  it.each(CASES)('GET %s: %s allowed with the grant, 403 without %s', async (url, header, roleName, key) => {
    const ok = await get(url, header);
    expect(ok.statusCode, ok.body).not.toBe(403);
    expect(ok.statusCode, ok.body).toBeLessThan(500);
    const deny = await withoutGrant(roleName, key, () => get(url, header));
    expect(deny.statusCode, deny.body).toBe(403);
  });

  it('service-cases and webhooks stay closed to roles the seed never grants them', async () => {
    expect((await get('/api/v1/service-cases', 'account-executive')).statusCode).toBe(403);
    expect((await get('/api/v1/integrations/webhooks', 'account-executive')).statusCode).toBe(403);
  });

  it('migrations no longer ride on settings:read', async () => {
    const res = await withoutGrant('Read-Only', 'settings:read', () => get('/api/v1/migrations', 'read-only'));
    expect(res.statusCode, res.body).not.toBe(403);
  });

  it('admin still reads leads (#28 does not lock out full roles)', async () => {
    const res = await get('/api/v1/leads', 'admin');
    expect(res.statusCode, res.body).toBe(200);
  });
});
