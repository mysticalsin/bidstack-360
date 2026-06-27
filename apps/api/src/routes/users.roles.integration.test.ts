// Integration tests for the capability manifest + granular user-role assignment.
// WHY these assertions matter:
//   - the capability manifest is what the frontend trusts to gate privileged
//     UI; if it under/over-reports permissions, the product authz model is wrong;
//   - assigning a Role must actually change the user's effective permissions
//     (the whole point of connecting RBAC to the product);
//   - assignment is idempotent (re-grant clears a prior revoke) and org-scoped
//     (a foreign role id can't be granted).
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
let memberId: string | null = null;
let roleId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;
const ROLE_NAME = `NOTIF-RBAC-TEST role ${Date.now()}`;
const PERM_KEY = 'tasks:read';
const ADMIN_HEADERS = { 'x-bidstack-e2e-role': 'admin' };

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
  const iso = await createIsolatedOrg('users-roles');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);

  // A throwaway member to assign roles to, and a throwaway custom role that
  // grants exactly one permission so we can prove the manifest reflects it.
  const member = await prisma.user.create({
    data: {
      orgId,
      clerkUser: `u_rbac_member_${Date.now()}`,
      email: `rbac-member-${Date.now()}@t.local`,
      name: 'RBAC Member',
      role: 'member',
    },
  });
  memberId = member.id;

  const perm = await prisma.permission.findFirst({ where: { key: PERM_KEY }, select: { id: true } });
  const role = await prisma.role.create({ data: { orgId, name: ROLE_NAME } });
  roleId = role.id;
  if (perm) {
    await prisma.rolePermission.create({
      data: { orgId, roleId: role.id, permissionId: perm.id },
    });
  }

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.userRole.deleteMany({
      where: { orgId, user: { email: { endsWith: '@bidstack.local' } } },
    });
    await prisma.user.deleteMany({
      where: { orgId, email: { endsWith: '@bidstack.local' } },
    });
    if (memberId) {
      await prisma.userRole.deleteMany({ where: { userId: memberId } });
      await prisma.user.deleteMany({ where: { id: memberId } });
    }
    if (roleId) {
      await prisma.rolePermission.deleteMany({ where: { roleId } });
      await prisma.role.deleteMany({ where: { id: roleId } });
    }
    await prisma.auditLog.deleteMany({
      where: { orgId, action: { startsWith: 'user_role.' }, targetId: memberId ?? undefined },
    });
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

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId || !memberId || !roleId) {
      throw new Error(`[skip] ${name}: DB/isolated fixtures unavailable`);
    }
    await fn();
  });

describe('capability manifest + user-role assignment', () => {
  t('GET /me/capabilities reports the caller as an admin with permissions', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/me/capabilities' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { isAdmin: boolean; permissions: string[]; userId: string };
    // The isolated stub identity is an admin and therefore holds many permission keys.
    expect(body.isAdmin).toBe(true);
    expect(body.permissions.length).toBeGreaterThan(0);
  });

  t('GET /me/capabilities can resolve a real Read-Only E2E browser identity', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/me/capabilities',
      headers: { 'x-bidstack-e2e-role': 'read-only' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { isAdmin: boolean; roles: string[]; permissions: string[] };
    expect(body.isAdmin).toBe(false);
    expect(body.roles).toContain('Read-Only');
    expect(body.permissions).toContain('accounts:read');
    expect(body.permissions).not.toContain('audit-log:read');
    expect(body.permissions.filter((permission) => permission.endsWith(':write'))).toEqual([]);
  });

  t('GET /me/capabilities maps the E2E Viewer identity onto read-only permissions', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/me/capabilities',
      headers: { 'x-bidstack-e2e-role': 'viewer' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      isAdmin: boolean;
      legacyRole: string;
      roles: string[];
      permissions: string[];
    };
    expect(body.isAdmin).toBe(false);
    expect(body.legacyRole).toBe('member');
    expect(body.roles).toContain('Read-Only');
    expect(body.permissions).toContain('accounts:read');
    expect(body.permissions).not.toContain('audit-log:read');
    expect(body.permissions.filter((permission) => permission.endsWith(':write'))).toEqual([]);
  });

  t('GET /me/capabilities can resolve a real Sales Manager E2E browser identity', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/me/capabilities',
      headers: { 'x-bidstack-e2e-role': 'manager' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { isAdmin: boolean; roles: string[]; permissions: string[] };
    expect(body.isAdmin).toBe(false);
    expect(body.roles).toContain('Sales Manager');
    expect(body.permissions).toContain('opportunities:write');
    expect(body.permissions).toContain('territories:write');
    expect(body.permissions).not.toContain('settings:write');
    expect(body.permissions).not.toContain('users:write');
  });

  t('assign -> list -> revoke a custom role, idempotently', async () => {
    const assign = await server.inject({
      method: 'POST',
      url: `/api/users/${memberId}/roles`,
      headers: ADMIN_HEADERS,
      payload: { roleId },
    });
    expect(assign.statusCode).toBe(200);
    let ids = (assign.json() as { items: { roleId: string }[] }).items.map((r) => r.roleId);
    expect(ids).toContain(roleId);

    // Re-assigning the same role is idempotent, not an error.
    const again = await server.inject({
      method: 'POST',
      url: `/api/users/${memberId}/roles`,
      headers: ADMIN_HEADERS,
      payload: { roleId },
    });
    expect(again.statusCode).toBe(200);

    const list = await server.inject({
      method: 'GET',
      url: `/api/users/${memberId}/roles`,
      headers: ADMIN_HEADERS,
    });
    ids = (list.json() as { items: { roleId: string }[] }).items.map((r) => r.roleId);
    expect(ids).toContain(roleId);

    const revoke = await server.inject({
      method: 'DELETE',
      url: `/api/users/${memberId}/roles/${roleId}`,
      headers: ADMIN_HEADERS,
    });
    expect(revoke.statusCode).toBe(204);

    const after = await server.inject({
      method: 'GET',
      url: `/api/users/${memberId}/roles`,
      headers: ADMIN_HEADERS,
    });
    ids = (after.json() as { items: { roleId: string }[] }).items.map((r) => r.roleId);
    expect(ids).not.toContain(roleId);

    // Re-grant after revoke must succeed (clears the soft-delete).
    const regrant = await server.inject({
      method: 'POST',
      url: `/api/users/${memberId}/roles`,
      headers: ADMIN_HEADERS,
      payload: { roleId },
    });
    expect(regrant.statusCode).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'user_role.assign', targetId: memberId! },
    });
    expect(audit).not.toBeNull();
  });

  t('assigning a role from another org is rejected with 400', async () => {
    const foreignOrg = await prisma.org.create({
      data: { name: 'RBAC Foreign', clerkOrg: `org_rbac_${Date.now()}` },
    });
    const foreignRole = await prisma.role.create({
      data: { orgId: foreignOrg.id, name: `foreign-${Date.now()}` },
    });
    try {
      const res = await server.inject({
        method: 'POST',
        url: `/api/users/${memberId}/roles`,
        headers: ADMIN_HEADERS,
        payload: { roleId: foreignRole.id },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await prisma.role.deleteMany({ where: { orgId: foreignOrg.id } });
      await prisma.org.delete({ where: { id: foreignOrg.id } });
    }
  });
});
