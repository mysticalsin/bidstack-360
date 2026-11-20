// WHY: every seeded system role holds tasks:read, so a denial has to come
// from a role this fixture builds. The badge is the same route the sidebar
// calls, and a caller without that grant must not receive the counts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';

let server: FastifyInstance;
let org: IsolatedOrg;
let restoreAuth: () => void;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('task-summary-auth');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
});

describe('task summary permission', () => {
  it('denies GET /api/tasks/summary when the fixture role lacks tasks:read', async () => {
    if (!dbReachable) throw new Error('[skip] task summary auth — DATABASE_URL not reachable');

    const allowed = await server.inject({ method: 'GET', url: '/api/tasks/summary' });
    expect(allowed.statusCode).toBe(200);

    const visitor = await prisma.user.findFirstOrThrow({
      where: { orgId: org.orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const companiesRead = await prisma.permission.findUniqueOrThrow({
      where: { key: 'companies:read' },
      select: { id: true },
    });
    const role = await prisma.role.create({
      data: {
        orgId: org.orgId,
        name: 'No tasks',
        description: 'fixture role without tasks:read',
        isSystem: false,
      },
    });
    await prisma.rolePermission.create({
      data: { orgId: org.orgId, roleId: role.id, permissionId: companiesRead.id },
    });
    const grants = await prisma.rolePermission.findMany({
      where: { roleId: role.id, deletedAt: null },
      select: { permission: { select: { key: true } } },
      take: 20,
    });
    expect(grants.map((row) => row.permission.key)).toEqual(['companies:read']);

    await prisma.userRole.deleteMany({ where: { userId: visitor.id, orgId: org.orgId } });
    await prisma.userRole.create({
      data: { userId: visitor.id, orgId: org.orgId, roleId: role.id },
    });
    clearRbacDecisionCacheForTest();

    const denied = await server.inject({ method: 'GET', url: '/api/tasks/summary' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ message: 'Requires permission: tasks:read' });
  });
});
