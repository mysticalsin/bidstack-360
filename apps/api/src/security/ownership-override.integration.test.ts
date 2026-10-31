/**
 * Owner-or-admin overrides (saved views, edit locks, crew runs) follow RBAC
 * (settings:write), not the legacy User.role column:
 *  - RBAC Admin with legacy role 'member'  -> may act on another user's row
 *  - legacy role 'admin' with only a Sales Manager grant -> may not
 */
import { randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

let server: FastifyInstance;
let orgId = '';
let callerId = '';
let otherUserId = '';
let adminRoleId = '';
let managerRoleId = '';
let restoreAuth: (() => void) | null = null;

beforeAll(async () => {
  const org = await createIsolatedOrg('ownover');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  const caller = await prisma.user.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  callerId = caller!.id;
  const other = await prisma.user.create({
    data: {
      orgId,
      clerkUser: `ownover_${randomUUID()}`,
      email: `ownover.${randomUUID()}@test.local`,
      name: 'Other User',
      role: 'member',
    },
  });
  otherUserId = other.id;

  const roles = await prisma.role.findMany({
    where: { orgId, name: { in: ['Admin', 'Sales Manager'] }, deletedAt: null },
    select: { id: true, name: true },
  });
  adminRoleId = roles.find((r) => r.name === 'Admin')!.id;
  managerRoleId = roles.find((r) => r.name === 'Sales Manager')!.id;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
});

async function becomeCaller(opts: { legacyRole: string; roleId: string }): Promise<void> {
  await prisma.user.update({ where: { id: callerId }, data: { role: opts.legacyRole } });
  await prisma.userRole.deleteMany({ where: { userId: callerId, orgId } });
  await prisma.userRole.create({ data: { orgId, userId: callerId, roleId: opts.roleId } });
  clearRbacDecisionCacheForTest();
}

const RBAC_ADMIN_LEGACY_MEMBER = () => becomeCaller({ legacyRole: 'member', roleId: adminRoleId });
const LEGACY_ADMIN_RBAC_MANAGER = () =>
  becomeCaller({ legacyRole: 'admin', roleId: managerRoleId });

async function otherUsersView(): Promise<string> {
  const v = await prisma.savedView.create({
    data: { orgId, userId: otherUserId, entity: 'OPPORTUNITY', name: `v-${randomUUID()}` },
  });
  return v.id;
}

async function otherUsersLock(): Promise<string> {
  const entityId = randomUUID();
  await prisma.entityEditLock.create({
    data: {
      orgId,
      entityType: 'opportunity',
      entityId,
      userId: otherUserId,
      sessionId: 'other-session',
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return entityId;
}

async function otherUsersCrewRun(): Promise<string> {
  const crew = await prisma.crew.create({ data: { orgId, name: `crew-${randomUUID()}` } });
  const run = await prisma.crewRun.create({
    data: { orgId, crewId: crew.id, startedByUserId: otherUserId, status: 'completed' },
  });
  return run.id;
}

describe('ownership overrides use RBAC, not the legacy role column', () => {
  beforeEach(() => clearRbacDecisionCacheForTest());

  describe('RBAC Admin, legacy role member', () => {
    beforeEach(RBAC_ADMIN_LEGACY_MEMBER);

    it('can delete another user’s saved view', async () => {
      const id = await otherUsersView();
      const res = await server.inject({ method: 'DELETE', url: `/api/v1/saved-views/${id}` });
      expect(res.statusCode).toBe(204);
    });

    it('can release another user’s edit lock', async () => {
      const entityId = await otherUsersLock();
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/entities/opportunity/${entityId}/lock`,
      });
      expect(res.statusCode).toBe(204);
      expect(await prisma.entityEditLock.count({ where: { orgId, entityId } })).toBe(0);
    });

    it('can read another user’s crew run', async () => {
      const id = await otherUsersCrewRun();
      const res = await server.inject({ method: 'GET', url: `/api/v1/crew-runs/${id}` });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('legacy role admin, RBAC Sales Manager only', () => {
    beforeEach(LEGACY_ADMIN_RBAC_MANAGER);

    it('cannot delete another user’s saved view', async () => {
      const id = await otherUsersView();
      const res = await server.inject({ method: 'DELETE', url: `/api/v1/saved-views/${id}` });
      expect(res.statusCode).toBe(403);
    });

    it('cannot release another user’s edit lock', async () => {
      const entityId = await otherUsersLock();
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/entities/opportunity/${entityId}/lock`,
      });
      expect(res.statusCode).toBe(403);
      expect(await prisma.entityEditLock.count({ where: { orgId, entityId } })).toBe(1);
    });

    it('cannot read another user’s crew run', async () => {
      const id = await otherUsersCrewRun();
      const res = await server.inject({ method: 'GET', url: `/api/v1/crew-runs/${id}` });
      expect(res.statusCode).toBe(404);
    });
  });
});
