// Integration test for M7 access-scoping on the opportunity DETAIL-by-id route.
// Regression: list/count were scoped but GET /opportunities/:id was org-only, so
// a country-restricted user could still open any opportunity by direct link/ID.
//
// The stub-auth identity is the isolated org's (unrestricted) admin user with zero
// group memberships. We TRANSIENTLY add it to a fresh FR-only access group to
// prove the gate, then restore (delete the membership + group + clear the scope cache).
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { invalidateAccessScope } from '../lib/access-scope.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let stubUserId: string | null = null;
let groupId: string | null = null;
let frOppId: string | null = null;
let deOppId: string | null = null;
let restoreAuth: (() => void) | null = null;
const TAG = `detail-scope-${Date.now()}`;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('opportunity-detail-scope');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const user = await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  stubUserId = user?.id ?? null;
  if (!stubUserId) return;

  // FR-only access group + membership for the stub user (was unrestricted).
  const group = await prisma.userGroup.create({
    data: { orgId, name: `${TAG}-grp`, scopeCountries: ['FR'], scopeAll: false },
  });
  groupId = group.id;
  await prisma.userGroupMember.create({ data: { orgId, userId: stubUserId, groupId: group.id } });

  // Two opps owned by NOBODY (ownerId null) so the owner-visibility rule can't
  // leak the out-of-scope one: FR is in scope, DE is not.
  const fr = await prisma.opportunity.create({
    data: {
      orgId,
      code: `${TAG}-FR`,
      customer: 'ScopeCo',
      name: 'FR deal',
      stage: 's1_lead',
      country: 'FR',
      ownerId: null,
    },
  });
  const de = await prisma.opportunity.create({
    data: {
      orgId,
      code: `${TAG}-DE`,
      customer: 'ScopeCo',
      name: 'DE deal',
      stage: 's1_lead',
      country: 'DE',
      ownerId: null,
    },
  });
  frOppId = fr.id;
  deOppId = de.id;

  server = await buildServer();
  await server.ready();
  invalidateAccessScope(orgId, stubUserId); // drop any cached unrestricted scope
});

afterAll(async () => {
  if (orgId) {
    if (frOppId || deOppId) {
      await prisma.opportunity.deleteMany({
        where: { id: { in: [frOppId, deOppId].filter((x): x is string => Boolean(x)) } },
      });
    }
    if (stubUserId && groupId) {
      await prisma.userGroupMember.deleteMany({ where: { orgId, userId: stubUserId, groupId } });
    }
    if (groupId) await prisma.userGroup.deleteMany({ where: { id: groupId } });
    if (stubUserId) invalidateAccessScope(orgId, stubUserId);
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId && !!stubUserId);

describe('opportunity detail-by-id access scoping', () => {
  t('a country-scoped user CAN open an in-scope opportunity', async () => {
    const res = await server.inject({ method: 'GET', url: `/api/opportunities/${frOppId}` });
    expect(res.statusCode).toBe(200);
  });

  t(
    'a country-scoped user CANNOT open an out-of-scope opportunity (404, not org-only leak)',
    async () => {
      const res = await server.inject({ method: 'GET', url: `/api/opportunities/${deOppId}` });
      expect(res.statusCode).toBe(404);
    },
  );
});
