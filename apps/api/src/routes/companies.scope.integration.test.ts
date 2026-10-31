// The older /companies routes (list + search, detail, hierarchy) ignored the
// caller's access scope while /accounts and /crm/companies/search applied it,
// so a country-restricted user could find and open any company by name or id.
//
// The stub identity is the isolated org's unrestricted admin; it is put in a
// fresh FR-only access group for this file so the scope applies.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const TAG = `coscope${Date.now()}`;
let server: FastifyInstance;
let orgId: string | null = null;
let userId: string | null = null;
let restoreAuth: (() => void) | null = null;
let frId = '';
let deId = '';

beforeAll(async () => {
  const org = await createIsolatedOrg('companies-scope');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const user = await prisma.user.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  userId = user.id;
  const group = await prisma.userGroup.create({
    data: { orgId, name: `${TAG}-grp`, scopeCountries: ['FR'], scopeAll: false },
  });
  await prisma.userGroupMember.create({ data: { orgId, userId, groupId: group.id } });
  // No key-account owner and no deals, so only the country rule decides.
  frId = (await prisma.company.create({ data: { orgId, name: `${TAG} Paris`, countryCode: 'FR' } })).id;
  deId = (await prisma.company.create({ data: { orgId, name: `${TAG} Berlin`, countryCode: 'DE' } })).id;
  invalidateAccessScope(orgId, userId);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) {
    invalidateAccessScope(orgId);
    await dropIsolatedOrg(orgId);
  }
});

describe('/companies honours the access scope', () => {
  it('search only returns in-scope companies', async () => {
    const res = await server.inject({ method: 'GET', url: `/api/v1/companies?search=${TAG}` });
    expect(res.statusCode, res.body).toBe(200);
    const ids = (res.json() as { items: Array<{ id: string }> }).items.map((c) => c.id);
    expect(ids).toEqual([frId]);
  });

  it('detail and hierarchy 404 for an out-of-scope company', async () => {
    expect((await server.inject({ method: 'GET', url: `/api/v1/companies/${frId}` })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: `/api/v1/companies/${deId}` })).statusCode).toBe(404);
    expect(
      (await server.inject({ method: 'GET', url: `/api/v1/companies/${frId}/hierarchy` })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ method: 'GET', url: `/api/v1/companies/${deId}/hierarchy` })).statusCode,
    ).toBe(404);
  });

  it('an unrestricted caller still sees both', async () => {
    await prisma.userGroupMember.deleteMany({ where: { orgId: orgId!, userId: userId! } });
    invalidateAccessScope(orgId!, userId!);
    const res = await server.inject({ method: 'GET', url: `/api/v1/companies?search=${TAG}` });
    const ids = (res.json() as { items: Array<{ id: string }> }).items.map((c) => c.id).sort();
    expect(ids).toEqual([frId, deId].sort());
  });
});
