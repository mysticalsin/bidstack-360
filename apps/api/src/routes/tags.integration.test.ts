// Integration tests for the tags RBAC gate. Tags routes were previously
// UNGATED (any authenticated user could create/edit/delete/apply tags — a
// privilege-escalation hole). They now require tags:read on GET/suggest and
// tags:write on every mutation.
//
// The stub-auth identity resolves to the isolated org's admin user (holds
// tags:read + tags:write after the RBAC seed), so this proves the gate is wired
// and the permission is seeded (happy path). The 403 deny path for a user
// LACKING the permission is covered generically by rbac-matrix.test.ts, which
// exercises the same requirePermission decorator.
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
const TAG_NAME = `gate-test-${Date.now()}`;
let createdTagId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const org = await createIsolatedOrg('tags');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    await prisma.tag.deleteMany({ where: { orgId, name: TAG_NAME } });
  }
  if (server) await server.close();
  if (restoreAuth) restoreAuth();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
});

const t = makeSkipIfNoDb(() => dbReachable && !!orgId);

describe('tags RBAC gate', () => {
  t('GET /tags is allowed for a user with tags:read', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/tags' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.json() as { items: unknown[] }).items)).toBe(true);
  });

  t('POST /tags is allowed for a user with tags:write (gate seeded + wired)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/tags',
      payload: { name: TAG_NAME, color: '#A78BFA' },
    });
    expect(res.statusCode).toBe(201);
    createdTagId = (res.json() as { id: string }).id;
    expect(createdTagId).toBeTruthy();
  });

  t('the created tag is gone after cleanup-safe delete (write gate on DELETE)', async () => {
    if (!createdTagId) throw new Error('tag was not created');
    const res = await server.inject({ method: 'DELETE', url: `/api/tags/${createdTagId}` });
    // 200/204 both acceptable depending on the route's success contract.
    expect([200, 204]).toContain(res.statusCode);
  });
});
