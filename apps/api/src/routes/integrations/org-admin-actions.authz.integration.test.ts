// Sellers hold integrations:write on purpose: POST /email/send and POST /sms/send
// use that grant, and a seller who can edit a contact must be able to send.
// That grant is not an org-admin grant. Minting an API key, installing a
// plugin, and disconnecting Slack all change the whole org:
//
//   - POST /integrations/api-keys accepts any permission scope and readOnly:false,
//     so a seller key can carry settings:write and then pass every settings gate.
//   - POST /plugins stores an org-wide plugin row.
//   - DELETE /integrations/slack/disconnect deletes SlackWorkspace by orgId,
//     not by the caller. The comment on the route says a member must not be
//     able to tear the workspace down.
//
// Dust credential routes already require the Admin role as well as
// integrations:write. These three must match. Mail and SMS send stay on
// integrations:write alone, which is why a dust resync (the same seller grant)
// is still allowed below.
import { afterAll, beforeAll, describe, expect } from 'vitest';

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
let restoreAuth: (() => void) | undefined;
let previousStubRoleHeader: string | undefined;

const SELLER_ROLES = ['account-executive', 'sdr', 'sales-manager', 'customer-success'] as const;

const KEY_BODY = {
  name: 'seller escalation',
  scopes: ['settings:write'],
  readOnly: false,
};

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
  isolatedOrg = await createIsolatedOrg('org-admin-actions');
  restoreAuth = useIsolatedOrgAuth(isolatedOrg.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  restoreAuth?.();
  if (previousStubRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  if (isolatedOrg) await dropIsolatedOrg(isolatedOrg.orgId);
  if (server) await server.close();
}, 30_000);

const skipIfNoDb = makeSkipIfNoDb(() => dbReachable && !!isolatedOrg);

describe('org integration actions are admin, not seller integrations:write', () => {
  skipIfNoDb('a seller cannot mint an API key that carries settings:write', async () => {
    for (const role of SELLER_ROLES) {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/integrations/api-keys',
        headers: { 'x-bidstack-e2e-role': role },
        payload: KEY_BODY,
      });
      expect(res.statusCode, role).toBe(403);
    }

    const keys = await prisma.apiKey.count({ where: { orgId: isolatedOrg!.orgId } });
    expect(keys).toBe(0);
  });

  skipIfNoDb('an admin can mint that key, and a seller cannot revoke it', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/integrations/api-keys',
      headers: { 'x-bidstack-e2e-role': 'admin' },
      payload: KEY_BODY,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;

    const revoked = await server.inject({
      method: 'DELETE',
      url: `/api/v1/integrations/api-keys/${id}`,
      headers: { 'x-bidstack-e2e-role': 'account-executive' },
    });
    expect(revoked.statusCode, revoked.body).toBe(403);

    const still = await prisma.apiKey.findFirst({
      where: { id, orgId: isolatedOrg!.orgId, revokedAt: null },
    });
    expect(still).not.toBeNull();
  });

  skipIfNoDb('a seller cannot install an org plugin', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/plugins',
      headers: { 'x-bidstack-e2e-role': 'account-executive' },
      payload: { manifestUrl: 'https://example.com/plugin.json', config: {} },
    });
    expect(res.statusCode, res.body).toBe(403);
    const rows = await prisma.plugin.count({ where: { orgId: isolatedOrg!.orgId } });
    expect(rows).toBe(0);
  });

  skipIfNoDb('a seller cannot delete the org Slack workspace', async () => {
    const admin = await prisma.user.findFirstOrThrow({
      where: { orgId: isolatedOrg!.orgId, email: 'e2e-admin@bidstack.local' },
      select: { id: true },
    });
    const token = await prisma.integrationToken.create({
      data: {
        orgId: isolatedOrg!.orgId,
        userId: admin.id,
        provider: IntegrationProvider.slack,
        accessTokenEncrypted: 'not-a-real-ciphertext',
        status: 'active',
      },
    });
    await prisma.slackWorkspace.create({
      data: {
        orgId: isolatedOrg!.orgId,
        integrationTokenId: token.id,
        slackTeamId: 'T_ORG_ADMIN',
        teamName: 'Org Admin Workspace',
        botUserId: 'U_ORG_ADMIN',
      },
    });

    const res = await server.inject({
      method: 'DELETE',
      url: '/api/v1/integrations/slack/disconnect',
      headers: { 'x-bidstack-e2e-role': 'account-executive' },
    });
    expect(res.statusCode, res.body).toBe(403);

    const workspace = await prisma.slackWorkspace.findUnique({
      where: { orgId: isolatedOrg!.orgId },
    });
    expect(workspace).not.toBeNull();
  });

  skipIfNoDb('a seller cannot start the org Slack OAuth handoff', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/slack/oauth/start',
      headers: { 'x-bidstack-e2e-role': 'account-executive' },
    });
    expect(res.statusCode, res.body).toBe(403);
  });

  skipIfNoDb('a seller can still request a dust resync', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/integrations/dust/resync',
      headers: { 'x-bidstack-e2e-role': 'account-executive' },
    });
    expect(res.statusCode, res.body).toBe(202);
  });
});
