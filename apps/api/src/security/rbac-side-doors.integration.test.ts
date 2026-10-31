/**
 * RBAC side doors: global search must not return result types (or
 * access-scoped opportunities) the caller cannot read, and edit locks (which
 * block everyone else from editing) require write access to the resource.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

let server: FastifyInstance;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousRoleHeader: string | undefined;
let oppName = '';

beforeAll(async () => {
  previousRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  const org = await createIsolatedOrg('rbac-side-doors');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const opp = await prisma.opportunity.findFirstOrThrow({
    where: { orgId, deletedAt: null },
    select: { name: true },
  });
  oppName = opp.name;
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (previousRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousRoleHeader;
  if (orgId) await dropIsolatedOrg(orgId);
});

function get(url: string, role: string) {
  return server.inject({ method: 'GET', url, headers: { 'x-bidstack-e2e-role': role } });
}

describe('RBAC side doors', () => {
  it('global search drops result types the caller cannot read', async () => {
    const q = encodeURIComponent(oppName.split(/\s+/)[0] ?? oppName);
    const asSdr = await get(`/api/v1/search?q=${q}&types=opportunity`, 'sdr');
    expect(asSdr.statusCode, asSdr.body).toBe(200);
    expect(asSdr.json().items).toEqual([]);
    const asAdmin = await get(`/api/v1/search?q=${q}&types=opportunity`, 'admin');
    expect(asAdmin.statusCode, asAdmin.body).toBe(200);
    expect(asAdmin.json().items.length).toBeGreaterThan(0);
  });

  it('edit locks require write access to the locked resource', async () => {
    const opp = await prisma.opportunity.findFirstOrThrow({
      where: { orgId: orgId!, deletedAt: null },
      select: { id: true },
    });
    const url = `/api/v1/entities/opportunity/${opp.id}/lock`;
    const ro = await server.inject({
      method: 'POST',
      url,
      headers: { 'x-bidstack-e2e-role': 'read-only' },
      payload: { sessionId: 'rbac-test' },
    });
    expect(ro.statusCode, ro.body).toBe(403);
    const ae = await server.inject({
      method: 'POST',
      url,
      headers: { 'x-bidstack-e2e-role': 'account-executive' },
      payload: { sessionId: 'rbac-test' },
    });
    expect(ae.statusCode, ae.body).toBe(200);
    const bogus = await server.inject({
      method: 'POST',
      url: `/api/v1/entities/not_a_thing/${opp.id}/lock`,
      headers: { 'x-bidstack-e2e-role': 'admin' },
      payload: { sessionId: 'rbac-test' },
    });
    expect(bogus.statusCode).toBe(400);
  });

  it('global search applies access-group scope to opportunities', async () => {
    const tag = `scopesrch${Date.now()}`;
    const user = await prisma.user.findFirstOrThrow({
      where: { orgId: orgId! },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const group = await prisma.userGroup.create({
      data: { orgId: orgId!, name: `${tag}-grp`, scopeCountries: ['FR'], scopeAll: false },
    });
    await prisma.userGroupMember.create({ data: { orgId: orgId!, userId: user.id, groupId: group.id } });
    const mk = (country: string) =>
      prisma.opportunity.create({
        data: { orgId: orgId!, code: `${tag}-${country}`, customer: tag, name: `${country} deal`, stage: 's1_lead', country, ownerId: null },
        select: { id: true },
      });
    const fr = await mk('FR');
    const de = await mk('DE');
    invalidateAccessScope(orgId!);
    try {
      const res = await server.inject({ method: 'GET', url: `/api/v1/search?q=${tag}&types=opportunity` });
      expect(res.statusCode, res.body).toBe(200);
      const ids = res.json().items.map((i: { id: string }) => i.id);
      expect(ids).toContain(fr.id);
      expect(ids).not.toContain(de.id);
    } finally {
      await prisma.userGroupMember.deleteMany({ where: { groupId: group.id } });
      await prisma.userGroup.deleteMany({ where: { id: group.id } });
      invalidateAccessScope(orgId!);
    }
  });
});
