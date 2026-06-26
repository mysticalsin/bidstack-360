// M7 — access-scoping integration tests.
//
// WHY these tests matter: the access-scoping layer is the contract that a
// group-restricted user cannot see opportunities outside their countries
// (mirroring source-system group access), while orgs that never configure
// groups keep exactly today's org-wide visibility. A regression here is a
// data-exposure incident, not a cosmetic bug.
//
// The dev/test auth stub authenticates every request as the FIRST seed user
// of org_seed_mantu, so we scope THAT user by group membership and watch the
// list change. All fixtures are UUID-pinned (MISTAKES 2026-06-07: no small
// random ranges in persistent fixtures) and cleaned up in afterAll.

import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { invalidateAccessScope } from '../lib/access-scope.js';
import { buildServer } from '../server.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let stubUserId: string | null = null;

// Pinned fixture identity — improbable ISO-2 user-assigned codes ZZ/QQ never
// appear in seeds; the marker makes ?search= return only our fixtures.
const marker = `SCOPE-${randomUUID()}`.slice(0, 42);
const oppIds: string[] = [];
const companyIds: string[] = [];
const fileIds: string[] = [];
const noteIds: string[] = [];
let oppInScopeId = '';
let oppOutOfScopeId = '';
let oppOwnedId = '';
let oppTerritoryId = '';
let companyInScopeId = '';
let companyOutOfScopeId = '';
let fileInScopeId = '';
let fileOutOfScopeId = '';
let territoryId: string | null = null;
let groupId: string | null = null;
let apiKeyId: string | null = null;
const rawApiKey = `bsk_test_${randomUUID()}`;

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

  // Same resolution the auth stub uses (plugins/auth.ts resolveStubAuth).
  const stubUser = await prisma.user.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
  });
  stubUserId = stubUser?.id ?? null;
  if (!stubUserId) return;

  const territory = await prisma.territory.create({
    data: {
      orgId,
      name: `Scope test territory ${randomUUID()}`,
      countryCodes: ['ZZ'],
      ownerId: stubUserId,
    },
  });
  territoryId = territory.id;

  const baseOpp = {
    orgId,
    customer: marker,
    stage: 's1_lead' as const,
    valueMicros: BigInt(0),
    probability: 0,
  };
  const [inScope, outOfScope, owned, viaTerritory] = await Promise.all([
    prisma.opportunity.create({
      data: { ...baseOpp, code: `SCOPE-${randomUUID()}`, name: 'in-scope ZZ', country: 'ZZ' },
    }),
    prisma.opportunity.create({
      data: { ...baseOpp, code: `SCOPE-${randomUUID()}`, name: 'out-of-scope QQ', country: 'QQ' },
    }),
    prisma.opportunity.create({
      data: {
        ...baseOpp,
        code: `SCOPE-${randomUUID()}`,
        name: 'owned QQ',
        country: 'QQ',
        ownerId: stubUserId,
      },
    }),
    prisma.opportunity.create({
      data: {
        ...baseOpp,
        code: `SCOPE-${randomUUID()}`,
        name: 'territory ZZ',
        territoryId: territory.id,
      },
    }),
  ]);
  oppInScopeId = inScope.id;
  oppOutOfScopeId = outOfScope.id;
  oppOwnedId = owned.id;
  oppTerritoryId = viaTerritory.id;
  oppIds.push(inScope.id, outOfScope.id, owned.id, viaTerritory.id);

  const [companyInScope, companyOutOfScope] = await Promise.all([
    prisma.company.create({
      data: {
        orgId,
        name: `${marker} account ZZ`,
        countryCode: 'ZZ',
        tier: 'key',
        keyAccountNotes: 'visible strategy note',
      },
    }),
    prisma.company.create({
      data: {
        orgId,
        name: `${marker} account QQ`,
        countryCode: 'QQ',
        tier: 'key',
        keyAccountNotes: 'hidden strategy note',
      },
    }),
  ]);
  companyInScopeId = companyInScope.id;
  companyOutOfScopeId = companyOutOfScope.id;
  companyIds.push(companyInScope.id, companyOutOfScope.id);

  const [fileInScope, fileOutOfScope] = await Promise.all([
    prisma.fileAttachment.create({
      data: {
        orgId,
        accountId: companyInScope.id,
        companyId: companyInScope.id,
        name: 'visible-account-plan.pdf',
        contentType: 'application/pdf',
        bytes: 10,
        storageKey: `${orgId}/scope-test/visible-account-plan.pdf`,
      },
    }),
    prisma.fileAttachment.create({
      data: {
        orgId,
        accountId: companyOutOfScope.id,
        companyId: companyOutOfScope.id,
        name: 'hidden-account-plan.pdf',
        contentType: 'application/pdf',
        bytes: 10,
        storageKey: `${orgId}/scope-test/hidden-account-plan.pdf`,
      },
    }),
  ]);
  fileInScopeId = fileInScope.id;
  fileOutOfScopeId = fileOutOfScope.id;
  fileIds.push(fileInScope.id, fileOutOfScope.id);

  const [noteInScope, noteOutOfScope] = await Promise.all([
    prisma.note.create({
      data: {
        orgId,
        accountId: companyInScope.id,
        companyId: companyInScope.id,
        authorUserId: stubUserId,
        title: 'Visible strategy',
        bodyMd: 'Visible account strategy',
      },
    }),
    prisma.note.create({
      data: {
        orgId,
        accountId: companyOutOfScope.id,
        companyId: companyOutOfScope.id,
        authorUserId: stubUserId,
        title: 'Hidden strategy',
        bodyMd: 'Hidden account strategy',
      },
    }),
  ]);
  noteIds.push(noteInScope.id, noteOutOfScope.id);

  // Read-only API key for the negative authz test.
  const apiKey = await prisma.apiKey.create({
    data: {
      orgId,
      name: `scope-test-readonly-${randomUUID()}`,
      hashedKey: createHash('sha256').update(rawApiKey).digest('hex'),
      prefix: rawApiKey.slice(0, 8),
      scopes: ['read'],
    },
  });
  apiKeyId = apiKey.id;

  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (dbReachable && orgId) {
    if (groupId) {
      await prisma.auditLog.deleteMany({ where: { targetType: 'user_group', targetId: groupId } });
      await prisma.userGroupMember.deleteMany({ where: { groupId } });
      await prisma.userGroup.deleteMany({ where: { id: groupId } });
    }
    if (oppIds.length > 0) {
      await prisma.opportunity.deleteMany({ where: { id: { in: oppIds }, orgId } });
    }
    if (noteIds.length > 0) {
      await prisma.note.deleteMany({ where: { id: { in: noteIds }, orgId } });
    }
    if (fileIds.length > 0) {
      await prisma.fileAttachment.deleteMany({ where: { id: { in: fileIds }, orgId } });
    }
    if (companyIds.length > 0) {
      await prisma.company.deleteMany({ where: { id: { in: companyIds }, orgId } });
    }
    if (territoryId) await prisma.territory.deleteMany({ where: { id: territoryId, orgId } });
    if (apiKeyId) await prisma.apiKey.deleteMany({ where: { id: apiKeyId, orgId } });
    // Leave no stale scope behind for other suites sharing this process.
    if (stubUserId) invalidateAccessScope(orgId);
  }
  if (server) await server.close();
  if (dbReachable) await prisma.$disconnect();
});

const skipIfNoDb = (name: string, fn: () => Promise<void> | void) =>
  it(name, async () => {
    if (!dbReachable || !orgId || !stubUserId) {
      throw new Error(`[skip] ${name} — DATABASE_URL not reachable or seed data missing`);
    }
    await fn();
  });

async function listVisibleFixtureIds(): Promise<Set<string>> {
  const res = await server.inject({
    method: 'GET',
    url: `/api/opportunities?search=${encodeURIComponent(marker)}&limit=50`,
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ items: Array<{ id: string }> }>();
  return new Set(body.items.map((o) => o.id));
}

describe('access scoping (user groups)', () => {
  skipIfNoDb('user in no groups keeps unrestricted org-wide visibility', async () => {
    const visible = await listVisibleFixtureIds();
    expect(visible.has(oppInScopeId)).toBe(true);
    expect(visible.has(oppOutOfScopeId)).toBe(true);
    expect(visible.has(oppOwnedId)).toBe(true);
    expect(visible.has(oppTerritoryId)).toBe(true);
  });

  skipIfNoDb(
    'group-scoped user only sees country-matching, territory-matching, and owned opportunities',
    async () => {
      // Create the group + membership through the API so the routes' own
      // cache invalidation (not test plumbing) makes the scope take effect.
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/user-groups',
        payload: { name: `Scope test group ${randomUUID()}`, scopeCountries: ['zz'] },
      });
      expect(createRes.statusCode).toBe(201);
      const group = createRes.json<{ id: string; scopeCountries: string[] }>();
      groupId = group.id;
      // Input normalization: "zz" must have been stored as ISO-2 "ZZ".
      expect(group.scopeCountries).toEqual(['ZZ']);

      const audit = await prisma.auditLog.findFirst({
        where: { orgId: orgId!, action: 'user_group.create', targetId: group.id },
      });
      expect(audit).not.toBeNull();

      const memberRes = await server.inject({
        method: 'POST',
        url: `/api/v1/user-groups/${group.id}/members`,
        payload: { userId: stubUserId },
      });
      expect(memberRes.statusCode).toBe(201);

      const visible = await listVisibleFixtureIds();
      expect(visible.has(oppInScopeId)).toBe(true); // country ZZ ∈ scope
      expect(visible.has(oppTerritoryId)).toBe(true); // territory countryCodes overlap
      expect(visible.has(oppOwnedId)).toBe(true); // owned rows always visible
      expect(visible.has(oppOutOfScopeId)).toBe(false); // QQ, not owned → hidden
    },
  );

  skipIfNoDb(
    'group-scoped user cannot read out-of-scope account strategy, files, or notes',
    async () => {
      expect(groupId).not.toBeNull();

      const keyAccounts = await server.inject({
        method: 'GET',
        url: `/api/v1/accounts/key?search=${encodeURIComponent(marker)}&limit=20`,
      });
      expect(keyAccounts.statusCode).toBe(200);
      const keyBody = keyAccounts.json<{
        items: Array<{ id: string; keyAccountNotes: string | null }>;
      }>();
      const keyIds = new Set(keyBody.items.map((item) => item.id));
      expect(keyIds.has(companyInScopeId)).toBe(true);
      expect(keyIds.has(companyOutOfScopeId)).toBe(false);
      expect(JSON.stringify(keyBody)).not.toContain('hidden strategy note');

      const inScopeFiles = await server.inject({
        method: 'GET',
        url: `/api/v1/files?accountId=${companyInScopeId}&companyId=${companyInScopeId}`,
      });
      expect(inScopeFiles.statusCode).toBe(200);
      expect(
        inScopeFiles
          .json<{ items: Array<{ id: string }> }>()
          .items.some((item) => item.id === fileInScopeId),
      ).toBe(true);

      const outOfScopeFiles = await server.inject({
        method: 'GET',
        url: `/api/v1/files?accountId=${companyOutOfScopeId}&companyId=${companyOutOfScopeId}`,
      });
      expect(outOfScopeFiles.statusCode).toBe(404);

      const outOfScopeDownload = await server.inject({
        method: 'GET',
        url: `/api/v1/files/${fileOutOfScopeId}/download`,
      });
      expect(outOfScopeDownload.statusCode).toBe(404);

      const outOfScopeNotes = await server.inject({
        method: 'GET',
        url: `/api/v1/notes?accountId=${companyOutOfScopeId}&companyId=${companyOutOfScopeId}`,
      });
      expect(outOfScopeNotes.statusCode).toBe(404);
    },
  );

  skipIfNoDb('group-scoped user cannot mutate global top-account curation', async () => {
    expect(groupId).not.toBeNull();

    const res = await server.inject({
      method: 'PUT',
      url: '/api/v1/accounts/top-list',
      payload: { companyIds: [companyInScopeId] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ message: string }>().message).toContain('unrestricted account scope');

    const [inScope, outOfScope] = await Promise.all([
      prisma.company.findUnique({
        where: { id: companyInScopeId },
        select: { topAccountRank: true },
      }),
      prisma.company.findUnique({
        where: { id: companyOutOfScopeId },
        select: { topAccountRank: true },
      }),
    ]);
    expect(inScope?.topAccountRank).toBeNull();
    expect(outOfScope?.topAccountRank).toBeNull();
  });

  skipIfNoDb('removing the membership restores unrestricted visibility', async () => {
    expect(groupId).not.toBeNull();
    const removeRes = await server.inject({
      method: 'DELETE',
      url: `/api/v1/user-groups/${groupId}/members/${stubUserId}`,
    });
    expect(removeRes.statusCode).toBe(204);

    const visible = await listVisibleFixtureIds();
    expect(visible.has(oppOutOfScopeId)).toBe(true);
  });

  skipIfNoDb('caller without settings:write cannot create groups (403)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/user-groups',
      headers: { 'x-api-key': rawApiKey },
      payload: { name: `Forbidden group ${randomUUID()}` },
    });
    expect(res.statusCode).toBe(403);

    // The same read-only credential may still LIST groups (settings:read).
    const list = await server.inject({
      method: 'GET',
      url: '/api/v1/user-groups',
      headers: { 'x-api-key': rawApiKey },
    });
    expect(list.statusCode).toBe(200);
  });
});
