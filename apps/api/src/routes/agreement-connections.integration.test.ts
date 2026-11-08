/**
 * Per-org agreement connections (slice 13a security review). Deployment env
 * names only the OAuth apps; every pull runs as the org's own Graph tenant or
 * DocuSign account, and a source can only use its own org's connection.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import { _resetIntegrationTokenKey } from '@bidstack/shared/server-crypto';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { __setAgreementIngestEnqueueForTest } from '../queues/agreement-ingest.js';
import { buildServer } from '../server.js';
import { __setAgreementConnectionFetchForTest } from '../services/agreement-sources/connections.js';
import { runAgreementSourceSync } from '../services/agreement-sources/sync.js';
import { fakeFetch, json } from '../test-support/agreement-source-fixtures.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const TENANT_A = 'aaaaaaaa-1111-4222-8333-444444444444';
const TENANT_B = 'bbbbbbbb-1111-4222-8333-444444444444';
const ENV_TENANT = 'eeeeeeee-1111-4222-8333-444444444444';
const ENV_KEYS = [
  'INTEGRATION_TOKEN_KEY',
  'MICROSOFT_TENANT_ID',
  'MICROSOFT_GRAPH_CLIENT_ID',
  'MICROSOFT_GRAPH_CLIENT_SECRET',
  'DOCUSIGN_INTEGRATION_KEY',
  'DOCUSIGN_CLIENT_SECRET',
  'AGREEMENT_SOURCES_SINGLE_TENANT',
  'PUBLIC_BASE_URL',
] as const;
const previousEnv: Record<string, string | undefined> = {};

let server: FastifyInstance;
let orgA = { orgId: '', clerkOrg: '' };
let orgB = { orgId: '', clerkOrg: '' };
let restoreAuth: (() => void) | null = null;
let userA = '';
let userB = '';

function call(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) {
  return server.inject({ method, url: `/api/v1${url}`, ...(payload !== undefined ? { payload: payload as object } : {}) });
}

/** Graph answers for one tenant: token, and a drive whose root names driveTenant. */
function graph(driveTenant: string) {
  return fakeFetch([
    ['https://login.microsoftonline.com/', () => json({ access_token: 'tok' })],
    [/\/root\?\$select=id,sharepointIds/, () => json({ id: 'root', sharepointIds: { tenantId: driveTenant } })],
    [/root\/delta/, () => json({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/drives/x/root/delta?token=done' })],
  ]);
}

function docusign(accountIds: string[]) {
  return fakeFetch([
    ['https://account-d.docusign.com/oauth/token', () => json({ access_token: 'ds-access', refresh_token: `ds-refresh-${randomUUID()}` })],
    [
      'https://account-d.docusign.com/oauth/userinfo',
      () => json({ accounts: accountIds.map((id, i) => ({ account_id: id, account_name: `Acct ${id}`, base_uri: 'https://demo.docusign.net', is_default: i === 0 })) }),
    ],
    [/\/envelopes\?/, () => json({ resultSetSize: '0', totalSetSize: '0', envelopes: [] })],
  ]);
}

async function connect(orgId: string, userId: string, provider: 'sharepoint' | 'docusign', data: Record<string, unknown>) {
  return prisma.agreementConnection.upsert({
    where: { orgId_provider: { orgId, provider } },
    create: { orgId, provider, status: 'connected', createdById: userId, ...data },
    update: { status: 'connected', ...data },
  });
}

const spPayload = (extra: Record<string, unknown> = {}) => ({
  kind: 'sharepoint',
  name: `Legal ${randomUUID().slice(0, 6)}`,
  config: { siteId: 'site-1', driveId: `b!drive-${randomUUID().slice(0, 6)}` },
  ...extra,
});

beforeAll(async () => {
  for (const k of ENV_KEYS) previousEnv[k] = process.env[k];
  Object.assign(process.env, {
    INTEGRATION_TOKEN_KEY: randomBytes(32).toString('hex'),
    MICROSOFT_TENANT_ID: ENV_TENANT,
    MICROSOFT_GRAPH_CLIENT_ID: 'client-fixture',
    MICROSOFT_GRAPH_CLIENT_SECRET: 'not-a-secret',
    DOCUSIGN_INTEGRATION_KEY: 'ik-fixture',
    DOCUSIGN_CLIENT_SECRET: 'not-a-secret',
    PUBLIC_BASE_URL: 'https://app.example.test',
  });
  delete process.env.AGREEMENT_SOURCES_SINGLE_TENANT;
  _resetIntegrationTokenKey();
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  orgA = await createIsolatedOrg('agreement-conn-a');
  orgB = await createIsolatedOrg('agreement-conn-b');
  userA = (await prisma.user.findFirstOrThrow({ where: { orgId: orgA.orgId }, orderBy: { createdAt: 'asc' } })).id;
  userB = (await prisma.user.findFirstOrThrow({ where: { orgId: orgB.orgId }, orderBy: { createdAt: 'asc' } })).id;
  await prisma.org.update({ where: { id: orgA.orgId }, data: { microsoftTenantId: TENANT_A } });
  await prisma.org.update({ where: { id: orgB.orgId }, data: { microsoftTenantId: TENANT_B } });
  restoreAuth = useIsolatedOrgAuth(orgA.clerkOrg);
  __setAgreementIngestEnqueueForTest(async (_job, jobId) => jobId);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  __setAgreementConnectionFetchForTest(null);
  __setAgreementIngestEnqueueForTest(null);
  await server?.close();
  restoreAuth?.();
  if (orgA.orgId) await dropIsolatedOrg(orgA.orgId);
  if (orgB.orgId) await dropIsolatedOrg(orgB.orgId);
  for (const k of ENV_KEYS) {
    if (previousEnv[k] === undefined) delete process.env[k];
    else process.env[k] = previousEnv[k];
  }
  _resetIntegrationTokenKey();
});

beforeEach(async () => {
  __setAgreementConnectionFetchForTest(null);
  delete process.env.AGREEMENT_SOURCES_SINGLE_TENANT;
  await prisma.agreementSource.deleteMany({ where: { orgId: { in: [orgA.orgId, orgB.orgId] } } });
  await prisma.agreementConnection.deleteMany({ where: { orgId: { in: [orgA.orgId, orgB.orgId] } } });
});

describe('connecting an org', () => {
  it('SharePoint admin consent records the consenting tenant, once', async () => {
    const { fetch, calls } = graph(TENANT_A);
    __setAgreementConnectionFetchForTest(fetch);
    const start = await call('POST', '/msa/connections/sharepoint/start', {});
    expect(start.statusCode, start.body).toBe(200);
    const url = new URL(start.json().url as string);
    expect(url.pathname).toBe(`/${TENANT_A}/v2.0/adminconsent`);
    expect(url.searchParams.get('client_id')).toBe('client-fixture');
    const state = url.searchParams.get('state')!;

    const cb = await server.inject({
      method: 'GET',
      url: `/api/v1/integrations/agreements/sharepoint/callback?state=${encodeURIComponent(state)}&tenant=${TENANT_A}&admin_consent=True`,
    });
    expect(cb.statusCode, cb.body).toBe(302);
    expect(cb.headers.location).toBe('https://app.example.test/agreements?connection=sharepoint&result=connected');
    const conn = await prisma.agreementConnection.findFirstOrThrow({ where: { orgId: orgA.orgId, provider: 'sharepoint' } });
    expect(conn).toMatchObject({ status: 'connected', externalTenantId: TENANT_A });
    expect(calls.some((c) => c.url.includes(`/${TENANT_A}/oauth2/v2.0/token`))).toBe(true);

    const replay = await server.inject({
      method: 'GET',
      url: `/api/v1/integrations/agreements/sharepoint/callback?state=${encodeURIComponent(state)}&tenant=${TENANT_B}&admin_consent=True`,
    });
    expect(replay.statusCode).toBe(403);
    expect((await prisma.agreementConnection.findFirstOrThrow({ where: { id: conn.id } })).externalTenantId).toBe(TENANT_A);

    const list = await call('GET', '/msa/connections');
    expect(list.json()).toMatchObject({ singleTenant: false, items: [{ provider: 'sharepoint', status: 'connected', externalTenantId: TENANT_A }] });
    expect(list.body).not.toMatch(/secret|stateNonce|refresh/i);
  });

  it('a fresh state cannot bind another already consented tenant', async () => {
    const { fetch, calls } = graph(TENANT_B);
    __setAgreementConnectionFetchForTest(fetch);
    const start = await call('POST', '/msa/connections/sharepoint/start', {});
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(start.json().url as string).searchParams.get('state')!;

    const cb = await server.inject({
      method: 'GET',
      url: `/api/v1/integrations/agreements/sharepoint/callback?state=${encodeURIComponent(state)}&tenant=${TENANT_B}&admin_consent=True`,
    });
    expect(cb.statusCode, cb.body).toBe(302);
    expect(cb.headers.location).toBe('https://app.example.test/agreements?connection=sharepoint&result=failed');
    const conn = await prisma.agreementConnection.findFirstOrThrow({ where: { orgId: orgA.orgId, provider: 'sharepoint' } });
    expect(conn.status).not.toBe('connected');
    expect(conn.externalTenantId).toBeNull();
    expect(calls).toHaveLength(0);

    const res = await call('POST', '/msa/sources', spPayload());
    expect(res.statusCode, res.body).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it('cannot start SharePoint consent without a provisioned tenant', async () => {
    await prisma.org.update({ where: { id: orgA.orgId }, data: { microsoftTenantId: null } });
    try {
      const start = await call('POST', '/msa/connections/sharepoint/start', {});
      expect(start.statusCode, start.body).toBe(409);
      expect(start.json().message).toMatch(/No Microsoft tenant is provisioned/);
    } finally {
      await prisma.org.update({ where: { id: orgA.orgId }, data: { microsoftTenantId: TENANT_A } });
    }
  });

  it('DocuSign OAuth stores the account and an encrypted refresh token', async () => {
    const { fetch } = docusign(['acct-a']);
    __setAgreementConnectionFetchForTest(fetch);
    const start = await call('POST', '/msa/connections/docusign/start', {});
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(start.json().url as string).searchParams.get('state')!;
    const cb = await server.inject({ method: 'GET', url: `/api/v1/integrations/agreements/docusign/callback?state=${encodeURIComponent(state)}&code=auth-code` });
    expect(cb.statusCode, cb.body).toBe(302);
    const conn = await prisma.agreementConnection.findFirstOrThrow({ where: { orgId: orgA.orgId, provider: 'docusign' } });
    expect(conn).toMatchObject({ status: 'connected', accountId: 'acct-a', baseUri: 'https://demo.docusign.net' });
    expect(conn.secretEncrypted).not.toMatch(/^ds-refresh-/);
    expect(decryptToken(conn.secretEncrypted!)).toMatch(/^ds-refresh-/);
  });
});

describe('sources only use their own org connection', () => {
  it('without a connection, deployment env credentials are not used for data access', async () => {
    const { fetch, calls } = graph(ENV_TENANT);
    __setAgreementConnectionFetchForTest(fetch);
    const res = await call('POST', '/msa/sources', spPayload());
    expect(res.statusCode, res.body).toBe(409);
    expect(calls.some((c) => c.url.includes(ENV_TENANT))).toBe(false);
  });

  it('rejects creating a source with another org connection', async () => {
    const foreign = await connect(orgB.orgId, userB, 'sharepoint', { externalTenantId: TENANT_B });
    const { fetch, calls } = graph(TENANT_B);
    __setAgreementConnectionFetchForTest(fetch);
    const res = await call('POST', '/msa/sources', spPayload({ connectionId: foreign.id }));
    expect(res.statusCode, res.body).toBe(404);
    expect(calls).toHaveLength(0);
    expect(await prisma.agreementSource.count({ where: { orgId: orgA.orgId } })).toBe(0);
  });

  it('rejects a drive that belongs to a different tenant than the connection', async () => {
    await connect(orgA.orgId, userA, 'sharepoint', { externalTenantId: TENANT_A });
    const { fetch } = graph(TENANT_B);
    __setAgreementConnectionFetchForTest(fetch);
    const res = await call('POST', '/msa/sources', spPayload());
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().message).toMatch(/different Microsoft tenant/);
  });

  it('creates a source on the org connection when the drive is in its tenant', async () => {
    const conn = await connect(orgA.orgId, userA, 'sharepoint', { externalTenantId: TENANT_A });
    const { fetch, calls } = graph(TENANT_A);
    __setAgreementConnectionFetchForTest(fetch);
    const res = await call('POST', '/msa/sources', spPayload());
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ connectionId: conn.id, configured: true });
    expect(calls.every((c) => !c.url.includes(ENV_TENANT))).toBe(true);
  });

  it('a sync refuses a source pointed at another org connection', async () => {
    const foreign = await connect(orgB.orgId, userB, 'sharepoint', { externalTenantId: TENANT_B });
    const source = await prisma.agreementSource.create({
      data: { orgId: orgA.orgId, kind: 'sharepoint', name: 'Tampered', config: { siteId: 's', driveId: 'b!d' }, connectionId: foreign.id, createdById: userA },
    });
    const { fetch, calls } = graph(TENANT_B);
    const run = await runAgreementSourceSync({ orgId: orgA.orgId, sourceId: source.id, runId: 'cross-1' }, { fetch, env: process.env });
    expect(run.state).toBe('failed');
    expect(run.reasons.join(' ')).toMatch(/does not belong to this organization/);
    expect(calls).toHaveLength(0);
  });

  it('a sync refuses a drive outside the connection tenant', async () => {
    const conn = await connect(orgA.orgId, userA, 'sharepoint', { externalTenantId: TENANT_A });
    const source = await prisma.agreementSource.create({
      data: { orgId: orgA.orgId, kind: 'sharepoint', name: 'Moved', config: { siteId: 's', driveId: 'b!d' }, connectionId: conn.id, createdById: userA },
    });
    const { fetch, calls } = graph(TENANT_B);
    const run = await runAgreementSourceSync({ orgId: orgA.orgId, sourceId: source.id, runId: 'own-1' }, { fetch, env: process.env });
    expect(run.state).toBe('failed');
    expect(run.reasons.join(' ')).toMatch(/different Microsoft tenant/);
    expect(calls.some((c) => c.url.includes('root/delta'))).toBe(false);
  });

  it('a sync refuses a connection bound to a tenant other than the provisioned one', async () => {
    const conn = await connect(orgA.orgId, userA, 'sharepoint', { externalTenantId: TENANT_B });
    const source = await prisma.agreementSource.create({
      data: { orgId: orgA.orgId, kind: 'sharepoint', name: 'Substituted', config: { siteId: 's', driveId: 'b!d' }, connectionId: conn.id, createdById: userA },
    });
    const { fetch, calls } = graph(TENANT_B);
    const run = await runAgreementSourceSync({ orgId: orgA.orgId, sourceId: source.id, runId: 'tenant-sub-1' }, { fetch, env: process.env });
    expect(run.state).toBe('failed');
    expect(run.reasons.join(' ')).toMatch(/not the tenant provisioned/);
    expect(calls).toHaveLength(0);
  });

  it('a DocuSign sync refuses an account the connection user no longer belongs to', async () => {
    const conn = await connect(orgA.orgId, userA, 'docusign', {
      accountId: 'acct-a',
      baseUri: 'https://demo.docusign.net',
      secretEncrypted: encryptToken('refresh-a'),
    });
    const source = await prisma.agreementSource.create({
      data: { orgId: orgA.orgId, kind: 'docusign', name: 'Envelopes', config: { keyword: 'MSA' }, connectionId: conn.id, createdById: userA },
    });
    const { fetch, calls } = docusign(['acct-other']);
    const run = await runAgreementSourceSync({ orgId: orgA.orgId, sourceId: source.id, runId: 'ds-own-1' }, { fetch, env: process.env });
    expect(run.state).toBe('failed');
    expect(run.reasons.join(' ')).toMatch(/no longer belongs/);
    expect(calls.some((c) => c.url.includes('/envelopes'))).toBe(false);
  });

  it('single-tenant mode, and only that mode, falls back to the env tenant', async () => {
    process.env.AGREEMENT_SOURCES_SINGLE_TENANT = 'true';
    const { fetch, calls } = graph(ENV_TENANT);
    __setAgreementConnectionFetchForTest(fetch);
    const res = await call('POST', '/msa/sources', spPayload());
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().connectionId).toBeNull();
    expect(calls.some((c) => c.url.includes(`/${ENV_TENANT}/oauth2/v2.0/token`))).toBe(true);
  });
});
