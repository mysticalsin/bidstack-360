/**
 * Stub auth's default user (no role header) is the oldest user of the org;
 * createIsolatedOrg relies on that to make its Admin visitor the caller. A role
 * header upserts ONE global user per role and moves it into the calling org
 * with its original createdAt, so once a suite has used the header, that user
 * is older than the visitor of any org created later. It then became the
 * default user there, and two-person rules (author vs approver) saw one person.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const SECOND_ADMIN = { 'x-bidstack-e2e-role': 'admin' };

let server: Awaited<ReturnType<typeof buildServer>>;
let previousRoleHeader: string | undefined;
let orgId = '';
let restoreAuth: (() => void) | null = null;

async function me(headers: Record<string, string> = {}) {
  const res = await server.inject({ method: 'GET', url: '/api/v1/me', headers });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; email: string | null };
}

beforeAll(async () => {
  previousRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
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

describe('stub auth default user', () => {
  it('stays the visitor of an org created after a role-header user existed', async () => {
    const earlier = await me(SECOND_ADMIN);
    expect(earlier.email).toBe('e2e-admin@bidstack.local');

    const org = await createIsolatedOrg('stub-default');
    orgId = org.orgId;
    restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

    const visitor = await me();
    const secondAdmin = await me(SECOND_ADMIN);
    expect(secondAdmin.id).toBe(earlier.id);

    const after = await me();
    expect(after.id).toBe(visitor.id);
    expect(after.id).not.toBe(secondAdmin.id);
    expect(after.email).toBe(`admin.${org.namespace}@test.local`);
  });
});
