// Integration tests for /api/roles and /api/permissions.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
const createdRoleIds: string[] = [];

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
      console.warn(`[skip] ${name} — DATABASE_URL not reachable`);
      return;
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
});
