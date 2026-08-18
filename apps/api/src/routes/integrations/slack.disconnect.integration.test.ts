// Integration tests for the RBAC gate on DELETE /integrations/slack/disconnect
// (apps/api/src/routes/integrations/slack.ts). SlackWorkspace is one row per
// org — the route deletes it unconditionally on orgId, so it must require
// integrations:write, not just authentication. Pattern mirrors
// org-settings.integration.test.ts: isolated org + the x-bidstack-e2e-role
// stub header to act as a role that lacks the permission.
import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest';

import { prisma, IntegrationProvider } from '@bidstack/db';

import { buildServer } from '../../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  type IsolatedOrg,
  useIsolatedOrgAuth,
} from '../../test-support/isolated-org.js';
import { makeSkipIfNoDb } from '../../test-support/skip-if-no-db.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let isolatedOrg: IsolatedOrg | null = null;
let adminUserId: string | null = null;
let restoreAuth: (() => void) | undefined;
let previousStubRoleHeader: string | undefined;

/** Seeds a minimal IntegrationToken + SlackWorkspace pair so DELETE has a row
 *  to tear down. The token ciphertext is intentionally bogus — the route's
 *  best-effort Slack revoke call is wrapped in a non-fatal try/catch, so a
 *  decrypt failure there never reaches the network. */
async function seedSlackWorkspace(orgId: string, userId: string): Promise<void> {
  const token = await prisma.integrationToken.create({
    data: {
      orgId,
      userId,
      provider: IntegrationProvider.slack,
      accessTokenEncrypted: 'not-a-real-ciphertext',
      status: 'active',
    },
  });
  await prisma.slackWorkspace.create({
    data: {
      orgId,
      integrationTokenId: token.id,
      slackTeamId: 'T_RBAC_TEST',
      teamName: 'RBAC Test Workspace',
      botUserId: 'U_RBAC_TEST_BOT',
    },
  });
}

async function cleanupSlackRows(orgId: string): Promise<void> {
  await prisma.slackWorkspace.deleteMany({ where: { orgId } });
  await prisma.integrationToken.deleteMany({ where: { orgId, provider: IntegrationProvider.slack } });
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
  isolatedOrg = await createIsolatedOrg('slack-disconnect-rbac');
  restoreAuth = useIsolatedOrgAuth(isolatedOrg.clerkOrg);
  const admin = await prisma.user.findFirst({
    where: { orgId: isolatedOrg.orgId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  adminUserId = admin?.id ?? null;
  server = await buildServer();
  await server.ready();
}, 30_000);

afterEach(async () => {
  if (isolatedOrg) await cleanupSlackRows(isolatedOrg.orgId);
});

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (isolatedOrg) await dropIsolatedOrg(isolatedOrg.orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
}, 30_000);

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!isolatedOrg && !!adminUserId);

describe('slack disconnect RBAC gate', () => {
  skipIfNoDb(
    'DELETE /integrations/slack/disconnect 403s for a role without integrations:write',
    async () => {
      await seedSlackWorkspace(isolatedOrg!.orgId, adminUserId!);

      const res = await server.inject({
        method: 'DELETE',
        // NOTE: the route path inside slack.ts already starts with
        // '/integrations/slack/...' and is registered under the
        // '/api/v1/integrations' prefix, so the live path doubles the
        // segment — this mirrors every other route in this file (oauth,
        // channels, workspace, events), not something introduced here.
        url: '/api/v1/integrations/integrations/slack/disconnect',
        headers: { 'x-bidstack-e2e-role': 'read-only' },
      });
      expect(res.statusCode).toBe(403);

      // The org-level workspace row must survive a denied request.
      const workspace = await prisma.slackWorkspace.findUnique({
        where: { orgId: isolatedOrg!.orgId },
      });
      expect(workspace).not.toBeNull();
    },
  );

  skipIfNoDb(
    'DELETE /integrations/slack/disconnect succeeds for the org admin holding integrations:write',
    async () => {
      await seedSlackWorkspace(isolatedOrg!.orgId, adminUserId!);

      const res = await server.inject({
        method: 'DELETE',
        // NOTE: the route path inside slack.ts already starts with
        // '/integrations/slack/...' and is registered under the
        // '/api/v1/integrations' prefix, so the live path doubles the
        // segment — this mirrors every other route in this file (oauth,
        // channels, workspace, events), not something introduced here.
        url: '/api/v1/integrations/integrations/slack/disconnect',
      });
      expect(res.statusCode).toBe(204);

      const workspace = await prisma.slackWorkspace.findUnique({
        where: { orgId: isolatedOrg!.orgId },
      });
      expect(workspace).toBeNull();
    },
  );
});
