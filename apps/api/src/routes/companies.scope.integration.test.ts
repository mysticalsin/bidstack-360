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
let hierarchyRootId = '';

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

  it('hierarchy under an in-scope company only names in-scope companies', async () => {
    // DE parent > FR root > { FR child, DE leaf, DE branch > FR grandchild }
    const mk = (name: string, countryCode: string, parentId?: string) =>
      prisma.company.create({ data: { orgId: orgId!, name: `${TAG} ${name}`, countryCode, parentId } });
    const parent = await mk('Holding DE', 'DE');
    const root = await mk('Root FR', 'FR', parent.id);
    const child = await mk('Child FR', 'FR', root.id);
    const leaf = await mk('Leaf DE', 'DE', root.id);
    const branch = await mk('Branch DE', 'DE', root.id);
    const grandchild = await mk('Grandchild FR', 'FR', branch.id);
    hierarchyRootId = root.id;

    const res = await server.inject({ method: 'GET', url: `/api/v1/companies/${root.id}/hierarchy` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('Holding DE');
    expect(res.body).not.toContain('Leaf DE');
    expect(res.body).not.toContain('Branch DE');
    expect(res.body).not.toContain(leaf.id);

    const body = res.json() as {
      ancestors: Array<{ id: string; name: string }>;
      directChildren: Array<{ id: string; name: string }>;
      tree: { id: string; name: string; children: Array<{ id: string; name: string; children: Array<{ id: string; name: string }> }> };
    };
    expect(body.ancestors).toEqual([{ id: parent.id, name: 'Restricted company' }]);
    expect(body.tree.name).toBe(`${TAG} Root FR`);
    const kids = new Map(body.tree.children.map((k) => [k.id, k]));
    expect([...kids.keys()].sort()).toEqual([child.id, branch.id].sort());
    expect(kids.get(child.id)?.name).toBe(`${TAG} Child FR`);
    // The out-of-scope branch stays only as a nameless link to the FR grandchild.
    expect(kids.get(branch.id)?.name).toBe('Restricted company');
    expect(kids.get(branch.id)?.children.map((g) => [g.id, g.name])).toEqual([
      [grandchild.id, `${TAG} Grandchild FR`],
    ]);
    expect(body.directChildren.map((d) => d.id).sort()).toEqual([child.id, branch.id].sort());
  });

  it('an unrestricted caller still sees both', async () => {
    await prisma.userGroupMember.deleteMany({ where: { orgId: orgId!, userId: userId! } });
    invalidateAccessScope(orgId!, userId!);
    const res = await server.inject({ method: 'GET', url: `/api/v1/companies?search=${TAG}` });
    const ids = (res.json() as { items: Array<{ id: string }> }).items.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([frId, deId]));
    const tree = await server.inject({ method: 'GET', url: `/api/v1/companies/${hierarchyRootId}/hierarchy` });
    expect(tree.body).toContain(`${TAG} Holding DE`);
    expect(tree.body).toContain(`${TAG} Leaf DE`);
    expect(tree.body).not.toContain('Restricted company');
  });
});
