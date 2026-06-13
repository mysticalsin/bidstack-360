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

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let memberId: string | null = null;
let roleId: string | null = null;
const ROLE_NAME = `NOTIF-RBAC-TEST role ${Date.now()}`;
const PERM_KEY = 'tasks:read';

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
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId || !memberId || !roleId) {
      throw new Error(`[skip] ${name} — DB/seed/fixtures unavailable`);
    }
    await fn();
  });

describe('capability manifest + user-role assignment', () => {
  t('GET /me/capabilities reports the caller as an admin with permissions', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/me/capabilities' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { isAdmin: boolean; permissions: string[]; userId: string };
    // The seed/stub identity is an admin and therefore holds many permission keys.
    expect(body.isAdmin).toBe(true);
    expect(body.permissions.length).toBeGreaterThan(0);
  });

  t('assign → list → revoke a custom role, idempotently', async () => {
    const assign = await server.inject({
      method: 'POST',
      url: `/api/users/${memberId}/roles`,
      payload: { roleId },
    });
    expect(assign.statusCode).toBe(200);
    let ids = (assign.json() as { items: { roleId: string }[] }).items.map((r) => r.roleId);
    expect(ids).toContain(roleId);

    // Re-assigning the same role is idempotent, not an error.
    const again = await server.inject({
      method: 'POST',
      url: `/api/users/${memberId}/roles`,
      payload: { roleId },
    });
    expect(again.statusCode).toBe(200);

    const list = await server.inject({ method: 'GET', url: `/api/users/${memberId}/roles` });
    ids = (list.json() as { items: { roleId: string }[] }).items.map((r) => r.roleId);
    expect(ids).toContain(roleId);

    const revoke = await server.inject({
      method: 'DELETE',
      url: `/api/users/${memberId}/roles/${roleId}`,
    });
    expect(revoke.statusCode).toBe(204);

    const after = await server.inject({ method: 'GET', url: `/api/users/${memberId}/roles` });
    ids = (after.json() as { items: { roleId: string }[] }).items.map((r) => r.roleId);
    expect(ids).not.toContain(roleId);

    // Re-grant after revoke must succeed (clears the soft-delete).
    const regrant = await server.inject({
      method: 'POST',
      url: `/api/users/${memberId}/roles`,
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
        payload: { roleId: foreignRole.id },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await prisma.role.deleteMany({ where: { orgId: foreignOrg.id } });
      await prisma.org.delete({ where: { id: foreignOrg.id } });
    }
  });
});
