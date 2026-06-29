// Integration tests for /api/tasks/*.
// Covers CRUD, status transitions, and assignee resolution.

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
let seedUserEmail: string | null = null;
let restoreAuth: (() => void) | null = null;
const createdTaskIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('tasks');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  const user = await prisma.user.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { email: true },
  });
  seedUserEmail = user?.email ?? null;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  for (const id of createdTaskIds) {
    await prisma.auditLog.deleteMany({ where: { targetType: 'task', targetId: id } });
    await prisma.task.deleteMany({ where: { id } });
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name} - DATABASE_URL not reachable or isolated org missing`);
    }
    await fn();
  });

describe('tasks routes', () => {
  skipIfNoDb('GET /api/tasks returns seeded tasks', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/tasks?limit=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ id: string; status: string; assignee: string | null }>;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    for (const row of body.items) {
      expect(['open', 'in_progress', 'done', 'blocked']).toContain(row.status);
    }
  });

  skipIfNoDb('GET /api/tasks/summary returns badge counts without list payload', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/tasks/summary' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      total: expect.any(Number),
      open: expect.any(Number),
      overdue: expect.any(Number),
      dueSoon: expect.any(Number),
    });
    expect(body.items).toBeUndefined();
  });

  skipIfNoDb('GET /api/tasks/summary refreshes after task mutations', async () => {
    const before = await server.inject({ method: 'GET', url: '/api/tasks/summary' });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as { total: number; open: number };

    const create = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        oppId: null,
        title: `Summary cache invalidation ${Date.now()}`,
        dueDate: null,
        status: 'open',
        assignee: null,
      },
    });
    expect(create.statusCode).toBe(201);
    createdTaskIds.push((create.json() as { id: string }).id);

    const after = await server.inject({ method: 'GET', url: '/api/tasks/summary' });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json() as { total: number; open: number };
    expect(afterBody.total).toBe(beforeBody.total + 1);
    expect(afterBody.open).toBe(beforeBody.open + 1);
  });

  skipIfNoDb('POST /api/tasks creates a task', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        oppId: null,
        title: 'Integration test task',
        dueDate: null,
        status: 'open',
        assignee: null,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      title: string;
      status: string;
      assignee: string | null;
    };
    expect(body.title).toBe('Integration test task');
    expect(body.status).toBe('open');
    expect(body.assignee).toBeNull();
    createdTaskIds.push(body.id);
  });

  skipIfNoDb('POST /api/tasks rejects opportunities outside the caller org', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        oppId: '11111111-2222-3333-4444-555555555555',
        title: 'Cross-tenant task',
        dueDate: null,
        status: 'open',
        assignee: null,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Opportunity not found in this org');
  });

  skipIfNoDb('PATCH /api/tasks/:id transitions status and updates title', async () => {
    if (createdTaskIds.length === 0) return;
    const id = createdTaskIds[0];
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      payload: { status: 'in_progress', title: 'Updated title' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; title: string; status: string };
    expect(body.id).toBe(id);
    expect(body.title).toBe('Updated title');
    expect(body.status).toBe('in_progress');
  });

  skipIfNoDb('PATCH /api/tasks/:id assigns to a user by email', async () => {
    if (createdTaskIds.length === 0 || !seedUserEmail) return;
    const id = createdTaskIds[0];
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      payload: { assignee: seedUserEmail },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { assignee: string | null };
    expect(body.assignee).toBe(seedUserEmail);
  });

  skipIfNoDb('PATCH /api/tasks/:id unsets assignee', async () => {
    if (createdTaskIds.length === 0) return;
    const id = createdTaskIds[0];
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      payload: { assignee: null },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { assignee: string | null };
    expect(body.assignee).toBeNull();
  });

  skipIfNoDb('PATCH /api/tasks/:id rejects unknown assignee emails', async () => {
    if (createdTaskIds.length === 0) return;
    const id = createdTaskIds[0];
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      payload: { assignee: 'not-a-user@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Assignee not found in this org');
  });

  skipIfNoDb('GET /api/tasks filters by status', async () => {
    if (createdTaskIds.length === 0) return;
    // Ensure at least one task is in_progress.
    await server.inject({
      method: 'PATCH',
      url: `/api/tasks/${createdTaskIds[0]}`,
      payload: { status: 'in_progress' },
    });
    const res = await server.inject({
      method: 'GET',
      url: '/api/tasks?status=in_progress&limit=10',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ status: string }> };
    for (const row of body.items) {
      expect(row.status).toBe('in_progress');
    }
  });

  skipIfNoDb('DELETE /api/tasks/:id removes the task', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        oppId: null,
        title: 'Task to delete',
        dueDate: null,
        status: 'open',
        assignee: null,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const id = (createRes.json() as { id: string }).id;
    createdTaskIds.push(id);

    const delRes = await server.inject({ method: 'DELETE', url: `/api/tasks/${id}` });
    expect(delRes.statusCode).toBe(204);

    const getRes = await server.inject({ method: 'GET', url: '/api/tasks?status=open&limit=100' });
    const body = getRes.json() as { items: Array<{ id: string }> };
    expect(body.items.some((t) => t.id === id)).toBe(false);
  });

  skipIfNoDb('PATCH /api/tasks/:id returns 404 for unknown id', async () => {
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/tasks/11111111-2222-3333-4444-555555555555',
      payload: { title: 'Ghost task' },
    });
    expect(res.statusCode).toBe(404);
  });
});
