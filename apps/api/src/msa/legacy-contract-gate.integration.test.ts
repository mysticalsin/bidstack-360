/**
 * The legacy /contract-agreements routes read and write the same rows as the
 * MSA library, so they must also honour msa:read / msa:write.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

let server: FastifyInstance;
let orgId = '';
let restoreAuth: (() => void) | null = null;
let prevRoleHeader: string | undefined;

beforeAll(async () => {
  prevRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  const org = await createIsolatedOrg('msa-legacy');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (prevRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = prevRoleHeader;
  if (orgId) await dropIsolatedOrg(orgId);
});

async function withoutGrant(roleName: string, key: string, fn: () => Promise<void>) {
  const role = await prisma.role.findFirstOrThrow({ where: { orgId, name: roleName } });
  const perm = await prisma.permission.findUniqueOrThrow({ where: { key } });
  await prisma.rolePermission.updateMany({ where: { roleId: role.id, permissionId: perm.id }, data: { deletedAt: new Date() } });
  clearRbacDecisionCacheForTest();
  try {
    await fn();
  } finally {
    await prisma.$executeRaw`UPDATE role_permissions SET deleted_at = NULL WHERE role_id = ${role.id}::uuid AND permission_id = ${perm.id}::uuid`;
    clearRbacDecisionCacheForTest();
  }
}

const H = { 'x-bidstack-e2e-role': 'account-executive' };

describe('legacy contract-agreements honour msa permissions', () => {
  it('reads need msa:read', async () => {
    const ok = await server.inject({ method: 'GET', url: '/api/v1/contract-agreements?accountKey=acme', headers: H });
    expect(ok.statusCode).toBe(200);
    await withoutGrant('Account Executive', 'msa:read', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/contract-agreements?accountKey=acme', headers: H });
      expect(res.statusCode).toBe(403);
    });
  });

  it('writes need msa:write', async () => {
    await withoutGrant('Account Executive', 'msa:write', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/contract-agreements',
        headers: H,
        payload: { accountKey: 'acme', reference: 'MSA-1' },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
