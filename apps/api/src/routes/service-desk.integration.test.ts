// Integration tests for /api/service-cases/*.
// Covers ticket creation, status updates, satisfaction scoring, and soft-delete.

import { randomUUID } from 'node:crypto';

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
let restoreAuth: (() => void) | null = null;
const createdCaseIds: string[] = [];
const foreignOrgIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('service-desk');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  for (const id of createdCaseIds) {
    await prisma.serviceCase.deleteMany({ where: { id } });
  }
  if (foreignOrgIds.length > 0) {
    await prisma.org.deleteMany({ where: { id: { in: foreignOrgIds } } });
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

async function createForeignUser() {
  const suffix = randomUUID();
  const org = await prisma.org.create({
    data: {
      clerkOrg: `org_service_foreign_${suffix}`,
      name: 'E2E Foreign Service Tenant',
    },
  });
  foreignOrgIds.push(org.id);
  return prisma.user.create({
    data: {
      orgId: org.id,
      clerkUser: `user_service_foreign_${suffix}`,
      email: `service-foreign-${suffix}@example.com`,
      name: 'Foreign Owner',
      role: 'service_desk',
    },
  });
}

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId) {
      throw new Error(`[skip] ${name} - DATABASE_URL not reachable or isolated org missing`);
    }
    await fn();
  });

describe('service-desk routes', () => {
  skipIfNoDb('GET /api/service-cases returns paginated cases', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/service-cases?limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ id: string; number: string; status: string; priority: string }>;
      nextCursor: string | null;
    };
    expect(Array.isArray(body.items)).toBe(true);
    for (const row of body.items) {
      expect(row.number).toMatch(/^CS-\d{5}$/);
      expect([
        'new',
        'open',
        'waiting_customer',
        'waiting_internal',
        'resolved',
        'closed',
        'escalated',
      ]).toContain(row.status);
      expect(['low', 'medium', 'high', 'critical']).toContain(row.priority);
    }
  });

  skipIfNoDb('POST /api/service-cases creates a ticket with auto-number', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/service-cases',
      payload: {
        subject: 'Integration test ticket',
        description: 'Created by integration test suite',
        priority: 'high',
        status: 'new',
        accountId: null,
        contactId: null,
        ownerId: null,
        source: 'web',
        satisfaction: null,
        slaDeadline: null,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; number: string; status: string; priority: string };
    expect(body.number).toMatch(/^CS-\d{5}$/);
    expect(body.status).toBe('new');
    expect(body.priority).toBe('high');
    createdCaseIds.push(body.id);
  });

  skipIfNoDb('GET /api/service-cases/:id returns the ticket', async () => {
    if (createdCaseIds.length === 0) return;
    const id = createdCaseIds[0];
    const res = await server.inject({ method: 'GET', url: `/api/service-cases/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; subject: string };
    expect(body.id).toBe(id);
    expect(body.subject).toBe('Integration test ticket');
  });

  skipIfNoDb('POST /api/service-cases rejects owner ids outside the tenant scope', async () => {
    const foreignUser = await createForeignUser();
    const res = await server.inject({
      method: 'POST',
      url: '/api/service-cases',
      payload: {
        subject: 'Cross-tenant owner ticket',
        description: 'Should not be created',
        priority: 'medium',
        status: 'new',
        accountId: null,
        contactId: null,
        ownerId: foreignUser.id,
        source: 'web',
        satisfaction: null,
        slaDeadline: null,
      },
    });

    expect(res.statusCode).toBe(400);
    const leaked = await prisma.serviceCase.findFirst({
      where: { subject: 'Cross-tenant owner ticket', ownerId: foreignUser.id },
    });
    expect(leaked).toBeNull();
  });

  skipIfNoDb(
    'PATCH /api/service-cases/:id updates status to resolved and sets resolvedAt',
    async () => {
      if (createdCaseIds.length === 0) return;
      const id = createdCaseIds[0];
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/service-cases/${id}`,
        payload: { status: 'resolved' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { status: string; resolvedAt: string | null };
      expect(body.status).toBe('resolved');
      expect(body.resolvedAt).toBeTruthy();
    },
  );

  skipIfNoDb(
    'PATCH /api/service-cases/:id rejects owner ids outside the tenant scope',
    async () => {
      if (createdCaseIds.length === 0) return;
      const foreignUser = await createForeignUser();
      const id = createdCaseIds[0];
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/service-cases/${id}`,
        payload: { ownerId: foreignUser.id },
      });

      expect(res.statusCode).toBe(400);
      const row = await prisma.serviceCase.findFirst({ where: { id }, select: { ownerId: true } });
      expect(row?.ownerId).not.toBe(foreignUser.id);
    },
  );

  skipIfNoDb(
    'PATCH /api/service-cases/:id updates status to closed and sets closedAt',
    async () => {
      if (createdCaseIds.length === 0) return;
      const id = createdCaseIds[0];
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/service-cases/${id}`,
        payload: { status: 'closed' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { status: string; closedAt: string | null };
      expect(body.status).toBe('closed');
      expect(body.closedAt).toBeTruthy();
    },
  );

  skipIfNoDb('PATCH /api/service-cases/:id records customer satisfaction', async () => {
    if (createdCaseIds.length === 0) return;
    const id = createdCaseIds[0];
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/service-cases/${id}`,
      payload: { satisfaction: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { satisfaction: number | null };
    expect(body.satisfaction).toBe(5);
  });

  skipIfNoDb('PATCH /api/service-cases/:id rejects invalid satisfaction scores', async () => {
    if (createdCaseIds.length === 0) return;
    const id = createdCaseIds[0];
    const res = await server.inject({
      method: 'PATCH',
      url: `/api/service-cases/${id}`,
      payload: { satisfaction: 6 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/satisfaction.*Number must be less than or equal to 5/);
  });

  skipIfNoDb('GET /api/service-cases filters by status', async () => {
    if (createdCaseIds.length === 0) return;
    // Ensure at least one case is closed.
    await server.inject({
      method: 'PATCH',
      url: `/api/service-cases/${createdCaseIds[0]}`,
      payload: { status: 'closed' },
    });
    const res = await server.inject({
      method: 'GET',
      url: '/api/service-cases?status=closed&limit=10',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ status: string }> };
    for (const row of body.items) {
      expect(row.status).toBe('closed');
    }
  });

  skipIfNoDb('GET /api/service-cases filters by priority', async () => {
    if (createdCaseIds.length === 0) return;
    const res = await server.inject({
      method: 'GET',
      url: '/api/service-cases?priority=high&limit=10',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ priority: string }> };
    for (const row of body.items) {
      expect(row.priority).toBe('high');
    }
  });

  skipIfNoDb('DELETE /api/service-cases/:id soft-deletes the ticket', async () => {
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/service-cases',
      payload: {
        subject: 'Ticket to delete',
        description: 'Will be soft-deleted',
        priority: 'low',
        status: 'new',
        accountId: null,
        contactId: null,
        ownerId: null,
        source: 'web',
        satisfaction: null,
        slaDeadline: null,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const id = (createRes.json() as { id: string }).id;
    createdCaseIds.push(id);

    const delRes = await server.inject({ method: 'DELETE', url: `/api/service-cases/${id}` });
    expect(delRes.statusCode).toBe(204);

    // Row still exists in DB but deletedAt is set.
    const row = await prisma.serviceCase.findFirst({
      where: { id, deletedAt: { not: null } },
      select: { deletedAt: true },
    });
    expect(row?.deletedAt).toBeTruthy();
  });

  skipIfNoDb('GET /api/service-cases/:id returns 404 for unknown id', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/service-cases/11111111-2222-3333-4444-555555555555',
    });
    expect(res.statusCode).toBe(404);
  });
});
