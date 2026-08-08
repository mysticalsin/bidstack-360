// Integration tests for the RBAC gate on org-level Dust credential writes.
// PUT/DELETE now require BOTH the admin role AND the granular
// integrations:write permission (apps/api/src/routes/dust-credentials.routes.ts).
// Pattern mirrors org-settings.integration.test.ts: isolated org + the
// x-bidstack-e2e-role stub header to act as a role that lacks the permission.
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  type IsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let isolatedOrg: IsolatedOrg | null = null;
let restoreAuth: (() => void) | undefined;
let previousStubRoleHeader: string | undefined;

async function seedDustCredentialRow(orgId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO integration_configs
      (id, org_id, type, name, config, credentials, is_active, created_at, updated_at)
    VALUES
      (gen_random_uuid(), ${orgId}::uuid, 'dust'::integration_type, 'dust',
       '{"workspaceId":"ws_test"}'::jsonb, '{"encrypted":"test"}'::jsonb,
       true, now(), now())
  `;
}

async function cleanupDustRows(orgId: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM integration_configs WHERE org_id = ${orgId}::uuid AND type::text = 'dust'
  `;
}

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  isolatedOrg = await createIsolatedOrg('dust-credentials-rbac');
  restoreAuth = useIsolatedOrgAuth(isolatedOrg.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  if (isolatedOrg) await cleanupDustRows(isolatedOrg.orgId);
  restoreAuth?.();
  if (isolatedOrg) await dropIsolatedOrg(isolatedOrg.orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
}, 30_000);

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!isolatedOrg);

describe('dust credentials RBAC gate', () => {
  skipIfNoDb('PUT /dust/credentials 403s for a role without integrations:write', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: '/api/v1/integrations/dust/credentials',
      headers: { 'x-bidstack-e2e-role': 'read-only' },
      // Plain fixture value (no provider-style prefix) so the pre-commit
      // secret scan doesn't flag it; the route only requires min(10).
      payload: { apiKey: 'dust-test-fixture-key-never-reaches-network', workspaceId: 'ws_test' },
    });
    expect(res.statusCode).toBe(403);
  });

  skipIfNoDb('DELETE /dust/credentials 403s for a role without integrations:write', async () => {
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/v1/integrations/dust/credentials',
      headers: { 'x-bidstack-e2e-role': 'read-only' },
    });
    expect(res.statusCode).toBe(403);
  });

  skipIfNoDb(
    'DELETE /dust/credentials succeeds for the org admin holding integrations:write',
    async () => {
      await seedDustCredentialRow(isolatedOrg!.orgId);

      const res = await server.inject({
        method: 'DELETE',
        url: '/api/v1/integrations/dust/credentials',
      });
      expect(res.statusCode).toBe(204);

      const row = await prisma.$queryRaw<Array<{ is_active: boolean }>>`
        SELECT is_active FROM integration_configs
        WHERE org_id = ${isolatedOrg!.orgId}::uuid AND type::text = 'dust' AND name = 'dust'
      `;
      expect(row[0]?.is_active).toBe(false);
    },
  );
});
