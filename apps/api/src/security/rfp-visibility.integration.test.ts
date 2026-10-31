/**
 * The org-wide RFP view (all proposals, not just your own) follows RBAC
 * (settings:write, lib/org-admin.ts), not the legacy User.role column:
 *  - RBAC Admin with legacy role 'member' -> sees another user's proposal
 *  - legacy role 'admin' with only a Sales Manager grant -> sees only their own
 */
import { randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const TAG = `rfpvis-${randomUUID().slice(0, 8)}`;
let server: FastifyInstance;
let orgId = '';
let callerId = '';
let adminRoleId = '';
let managerRoleId = '';
let othersProposalId = '';
let ownProposalId = '';
let restoreAuth: (() => void) | null = null;

beforeAll(async () => {
  const org = await createIsolatedOrg('rfp-visibility');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  callerId = (await prisma.user.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: 'asc' } })).id;
  const other = await prisma.user.create({
    data: {
      orgId,
      clerkUser: `rfpvis_${randomUUID()}`,
      email: `rfpvis.${randomUUID()}@test.local`,
      name: 'Other Owner',
      role: 'member',
    },
  });
  othersProposalId = (
    await prisma.proposal.create({ data: { orgId, name: `${TAG} theirs`, ownerId: other.id } })
  ).id;
  ownProposalId = (
    await prisma.proposal.create({ data: { orgId, name: `${TAG} mine`, ownerId: callerId } })
  ).id;
  const roles = await prisma.role.findMany({
    where: { orgId, name: { in: ['Admin', 'Sales Manager'] }, deletedAt: null },
    select: { id: true, name: true },
    take: 2,
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

async function becomeCaller(legacyRole: string, roleId: string): Promise<void> {
  await prisma.user.update({ where: { id: callerId }, data: { role: legacyRole } });
  await prisma.userRole.deleteMany({ where: { userId: callerId, orgId } });
  await prisma.userRole.create({ data: { orgId, userId: callerId, roleId } });
  clearRbacDecisionCacheForTest();
}

async function listedIds(): Promise<string[]> {
  const res = await server.inject({ method: 'GET', url: `/api/v1/proposals?search=${TAG}&limit=50` });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { items: Array<{ id: string }> }).items.map((p) => p.id).sort();
}

describe('org-wide RFP visibility', () => {
  it('RBAC Admin with legacy role member sees every proposal', async () => {
    await becomeCaller('member', adminRoleId);
    expect(await listedIds()).toEqual([othersProposalId, ownProposalId].sort());
    const res = await server.inject({ method: 'GET', url: `/api/v1/proposals/${othersProposalId}` });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('legacy admin without the RBAC grant sees only their own', async () => {
    await becomeCaller('admin', managerRoleId);
    expect(await listedIds()).toEqual([ownProposalId]);
    const res = await server.inject({ method: 'GET', url: `/api/v1/proposals/${othersProposalId}` });
    expect(res.statusCode, res.body).toBe(404);
  });
});
