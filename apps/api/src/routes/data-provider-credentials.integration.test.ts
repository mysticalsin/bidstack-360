// Integration tests for the RBAC gate on org-level data-provider credential
// writes (apps/api/src/routes/data-provider-credentials.routes.ts). PUT/DELETE
// require BOTH the admin role AND the granular integrations:write permission.
// Pattern mirrors org-settings.integration.test.ts: isolated org + the
// x-bidstack-e2e-role stub header to act as a role that lacks the permission.
import { afterAll, beforeAll, describe, expect } from 'vitest';

import { prisma } from '@bidstack/db';
import { _resetIntegrationTokenKey } from '@bidstack/shared/server-crypto';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  type IsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../test-support/skip-if-no-db.js';

// PUT encrypts the API key at rest (encryptSecret), which needs a real
// INTEGRATION_TOKEN_KEY — mirrors webhooks.integration.test.ts.
const TEST_TOKEN_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let isolatedOrg: IsolatedOrg | null = null;
let restoreAuth: (() => void) | undefined;
let previousStubRoleHeader: string | undefined;
let previousTokenKey: string | undefined;

async function cleanupDataProviderRows(orgId: string): Promise<void> {
  // Data-provider rows reuse the 'dust' integration_type with a distinct
  // 'data-provider:' name prefix (see lib/data-provider-credentials.ts) so
  // they don't collide with the org's actual Dust credentials row.
  await prisma.$executeRaw`
    DELETE FROM integration_configs
    WHERE org_id = ${orgId}::uuid AND type::text = 'dust' AND name LIKE 'data-provider:%'
  `;
}

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  previousTokenKey = process.env.INTEGRATION_TOKEN_KEY;
  process.env.INTEGRATION_TOKEN_KEY = TEST_TOKEN_KEY;
  _resetIntegrationTokenKey();
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  isolatedOrg = await createIsolatedOrg('data-provider-credentials-rbac');
  restoreAuth = useIsolatedOrgAuth(isolatedOrg.clerkOrg);
  await cleanupDataProviderRows(isolatedOrg.orgId);
  server = await buildServer();
  await server.ready();
}, 30_000);

afterAll(async () => {
  if (server) await server.close();
  if (isolatedOrg) await cleanupDataProviderRows(isolatedOrg.orgId);
  restoreAuth?.();
  if (isolatedOrg) await dropIsolatedOrg(isolatedOrg.orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
  if (previousTokenKey === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
  else process.env.INTEGRATION_TOKEN_KEY = previousTokenKey;
  _resetIntegrationTokenKey();
}, 30_000);

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!isolatedOrg);

describe('data provider credentials RBAC gate', () => {
  skipIfNoDb(
    'PUT /data-providers/credentials/:provider 403s for a role without integrations:write',
    async () => {
      const res = await server.inject({
        method: 'PUT',
        url: '/api/v1/integrations/data-providers/credentials/seamless',
        headers: { 'x-bidstack-e2e-role': 'read-only' },
        payload: { apiKey: 'test-key-should-not-be-saved' },
      });
      expect(res.statusCode).toBe(403);
    },
  );

  skipIfNoDb(
    'PUT /data-providers/credentials/:provider succeeds for the org admin holding integrations:write',
    async () => {
      const res = await server.inject({
        method: 'PUT',
        url: '/api/v1/integrations/data-providers/credentials/seamless',
        payload: { apiKey: 'test-key-allowed' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ provider: 'seamless', configured: true });
    },
  );

  skipIfNoDb(
    'DELETE /data-providers/credentials/:provider 403s for a role without integrations:write',
    async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: '/api/v1/integrations/data-providers/credentials/seamless',
        headers: { 'x-bidstack-e2e-role': 'read-only' },
      });
      expect(res.statusCode).toBe(403);
    },
  );

  skipIfNoDb(
    'DELETE /data-providers/credentials/:provider succeeds for the org admin holding integrations:write',
    async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: '/api/v1/integrations/data-providers/credentials/seamless',
      });
      expect(res.statusCode).toBe(204);
    },
  );
});
