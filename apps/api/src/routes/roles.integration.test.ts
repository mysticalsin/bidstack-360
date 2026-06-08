// Integration tests for /api/roles and /api/permissions.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
const createdRoleIds: string[] = [];
const createdAuditIds: bigint[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (server) await server.close();
  if (dbReachable) {
    if (createdAuditIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { id: { in: createdAuditIds } } });
    }
    for (const id of createdRoleIds) {
      try {
        await prisma.role.deleteMany({ where: { id } });
      } catch {
        /* ignore */
      }
    }
    await prisma.$disconnect();
  }
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable) {
      throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    }
    await fn();
  });

describe('roles routes', () => {
  skipIfNoDb('GET /api/roles returns list', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/roles' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  skipIfNoDb('GET /api/permissions returns list', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/permissions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    if (body.items.length > 0) {
      expect(body.items[0]).toMatchObject({
        id: expect.any(String),
        key: expect.any(String),
        name: expect.any(String),
      });
    }
  });

  skipIfNoDb('POST /api/roles creates a role (admin)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/roles',
      payload: { name: 'Audit Test Role', description: 'Created during audit', permissionIds: [] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Audit Test Role');
    createdRoleIds.push(body.id);
  });

  skipIfNoDb('POST /api/roles rejects unknown permissionIds (BS-33 create)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/roles',
      payload: {
        name: `Bad Permission Role ${randomUUID().slice(0, 8)}`,
        permissionIds: ['00000000-0000-0000-0000-000000000001'],
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { message: string }).message).toMatch(/Unknown permissionId/);
  });

  skipIfNoDb('PATCH /api/roles/:id updates a role', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/roles',
      payload: { name: 'Patch Role', permissionIds: [] },
    });
    const id = createRes.json().id;
    createdRoleIds.push(id);

    const patch = await server.inject({
      method: 'PATCH',
      url: `/api/roles/${id}`,
      payload: { name: 'Patched Role Name' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ id, name: 'Patched Role Name' });
  });

  skipIfNoDb('DELETE /api/roles/:id soft-deletes', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/roles',
      payload: { name: 'Delete Role', permissionIds: [] },
    });
    const id = createRes.json().id;
    createdRoleIds.push(id);

    const del = await server.inject({ method: 'DELETE', url: `/api/roles/${id}` });
    expect(del.statusCode).toBe(204);

    const list = (await server.inject({ method: 'GET', url: '/api/roles' })).json();
    expect(list.items.some((r: { id: string }) => r.id === id)).toBe(false);
  });

  skipIfNoDb('PATCH /api/roles/:id returns 404 for unknown id', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/roles/11111111-2222-3333-4444-555555555555',
      payload: { name: 'Nope' },
    });
    expect(res.statusCode).toBe(404);
  });

  // BS-33: supplying a non-existent permissionId must return 400, not silently
  // wire an orphaned rolePermission row.
  skipIfNoDb('PATCH /api/roles/:id rejects unknown permissionIds (BS-33)', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/roles',
      payload: { name: 'BS33 Test Role', permissionIds: [] },
    });
    expect(createRes.statusCode).toBe(201);
    const id = createRes.json().id as string;
    createdRoleIds.push(id);

    const res = await server.inject({
      method: 'PATCH',
      url: `/api/roles/${id}`,
      payload: { permissionIds: ['00000000-0000-0000-0000-000000000001'] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { message: string };
    expect(body.message).toMatch(/Unknown permissionId/);
  });

  skipIfNoDb(
    'writes rich audit rows for role create/update/delete without duplicate request rows',
    async () => {
      const permissionsRes = await server.inject({ method: 'GET', url: '/api/permissions' });
      expect(permissionsRes.statusCode).toBe(200);
      const permission = (permissionsRes.json() as { items: Array<{ id: string; key: string }> })
        .items[0];
      expect(permission).toBeDefined();

      const suffix = randomUUID().slice(0, 8);
      const roleName = `Audited Role ${suffix}`;
      const patchedName = `Audited Role Updated ${suffix}`;
      const startedAt = new Date();

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/roles',
        payload: {
          name: roleName,
          description: 'Requires audit trail',
          permissionIds: [permission.id],
        },
      });
      expect(createRes.statusCode).toBe(201);
      const id = createRes.json().id as string;
      createdRoleIds.push(id);

      const patchRes = await server.inject({
        method: 'PATCH',
        url: `/api/roles/${id}`,
        payload: { name: patchedName, permissionIds: [] },
      });
      expect(patchRes.statusCode).toBe(200);

      const deleteRes = await server.inject({ method: 'DELETE', url: `/api/roles/${id}` });
      expect(deleteRes.statusCode).toBe(204);

      const auditRows = await prisma.auditLog.findMany({
        where: { targetType: 'role', targetId: id },
        orderBy: { at: 'asc' },
      });
      createdAuditIds.push(...auditRows.map((row) => row.id));
      expect(auditRows.map((row) => row.action)).toEqual([
        'role.create',
        'role.update',
        'role.delete',
      ]);

      const createDiff = auditRows[0]!.diff as Record<string, unknown>;
      expect(createDiff).toMatchObject({ actorKind: 'user', name: roleName });
      expect(createDiff.permissionKeys).toEqual(expect.arrayContaining([permission.key]));

      const updateDiff = auditRows[1]!.diff as Record<string, unknown>;
      const updateChanges = updateDiff.changes as Record<string, Record<string, unknown>>;
      expect(updateDiff).toMatchObject({ actorKind: 'user' });
      expect(updateChanges.name).toMatchObject({ from: roleName, to: patchedName });
      expect(updateChanges.permissions.fromKeys).toEqual(expect.arrayContaining([permission.key]));
      expect(updateChanges.permissions.toKeys).toEqual([]);

      const deleteDiff = auditRows[2]!.diff as Record<string, unknown>;
      expect(deleteDiff).toMatchObject({ actorKind: 'user', name: patchedName });
      expect(deleteDiff.permissionKeys).toEqual([]);

      const detailPath = `/api/v1/roles/${id}`;
      const genericRows = await prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT id
      FROM audit_log
      WHERE action = 'http.mutation.success'
        AND target_type = 'http_request'
        AND at >= ${startedAt}
        AND ((diff->>'path') = '/api/v1/roles' OR (diff->>'path') = ${detailPath})
    `;
      createdAuditIds.push(...genericRows.map((row) => row.id));
      expect(genericRows).toHaveLength(0);
    },
  );
});
