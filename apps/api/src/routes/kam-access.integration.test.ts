// Integration test for M7 in-tenant access-scoping on KAM account routes (B4).
// A country-restricted user must NOT read KAM data for an out-of-scope account,
// even within their own org. Mirrors opportunities.detail-scope: transiently put
// the (otherwise unrestricted) stub user in an FR-only access group, prove the
// gate on an FR (in-scope) vs DE (out-of-scope) company, then restore.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { invalidateAccessScope } from '../lib/access-scope.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let stubUserId: string | null = null;
let groupId: string | null = null;
let frCompanyId: string | null = null;
let deCompanyId: string | null = null;
const TAG = `kam-scope-${Date.now()}`;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
  orgId = org?.id ?? null;
  if (!orgId) return;
  const user = await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  stubUserId = user?.id ?? null;
  if (!stubUserId) return;

  const group = await prisma.userGroup.create({
    data: { orgId, name: `${TAG}-grp`, scopeCountries: ['FR'], scopeAll: false },
  });
  groupId = group.id;
  await prisma.userGroupMember.create({ data: { orgId, userId: stubUserId, groupId: group.id } });

  const fr = await prisma.company.create({ data: { orgId, name: `${TAG}-FR`, source: 'manual', countryCode: 'FR' } });
  const de = await prisma.company.create({ data: { orgId, name: `${TAG}-DE`, source: 'manual', countryCode: 'DE' } });
  frCompanyId = fr.id;
  deCompanyId = de.id;

  server = await buildServer();
  await server.ready();
  invalidateAccessScope(orgId, stubUserId);
});

afterAll(async () => {
  if (orgId) {
    const ids = [frCompanyId, deCompanyId].filter((x): x is string => Boolean(x));
    if (ids.length) await prisma.company.deleteMany({ where: { id: { in: ids } } });
    if (stubUserId && groupId) await prisma.userGroupMember.deleteMany({ where: { orgId, userId: stubUserId, groupId } });
    if (groupId) await prisma.userGroup.deleteMany({ where: { id: groupId } });
    if (stubUserId) invalidateAccessScope(orgId, stubUserId);
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId || !stubUserId) throw new Error(`[skip] ${name} — DB/seed org/user unavailable`);
    await fn();
  });

describe('KAM account access scoping (B4)', () => {
  t('a country-scoped user CAN read an in-scope (FR) KAM account', async () => {
    const res = await server.inject({ method: 'GET', url: `/api/v1/kam/initiatives?companyId=${frCompanyId}` });
    expect(res.statusCode).toBe(200);
  });

  t('a country-scoped user CANNOT read an out-of-scope (DE) KAM account (403, not an org-only leak)', async () => {
    const initiatives = await server.inject({ method: 'GET', url: `/api/v1/kam/initiatives?companyId=${deCompanyId}` });
    expect(initiatives.statusCode).toBe(403);
    // Same gate on the per-account to-do + KPI roll-up.
    const todos = await server.inject({ method: 'GET', url: `/api/v1/kam/accounts/${deCompanyId}/todos` });
    expect(todos.statusCode).toBe(403);
    const kpi = await server.inject({ method: 'GET', url: `/api/v1/kam/reports/account/${deCompanyId}` });
    expect(kpi.statusCode).toBe(403);
  });
});
