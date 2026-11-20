/**
 * Microsoft 365 settings routes read the caller's own Graph grant: status
 * reflects the granted read scopes, other tenants never leak in, and
 * connect or disconnect act on that grant only. Provider calls are mocked.
 */
import { randomBytes } from 'node:crypto';

import { IntegrationProvider, prisma } from '@bidstack/db';
import { encryptToken } from '@bidstack/shared/token-crypto';
import { _resetIntegrationTokenKey } from '@bidstack/shared/server-crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/fetch-timeout.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWithTimeout: vi.fn(async () => new Response(null, { status: 200 })),
}));

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';

const ENV_KEYS = ['INTEGRATION_TOKEN_KEY', 'MICROSOFT_GRAPH_CLIENT_ID', 'MICROSOFT_GRAPH_CLIENT_SECRET'] as const;
const previousEnv: Record<string, string | undefined> = {};

let server: FastifyInstance;
let orgId = '';
let otherOrgId = '';
let userId = '';
let otherUserId = '';
let restoreAuth: (() => void) | null = null;

interface Status {
  emailConnected: boolean;
  calendarConnected: boolean;
  emailLastSync: string | null;
  emailError: string | null;
}

async function status(): Promise<Status> {
  const res = await server.inject({ method: 'GET', url: '/api/v1/settings/microsoft' });
  expect(res.statusCode).toBe(200);
  return res.json<Status>();
}

async function seedGrant(opts: { org?: string; user?: string; scope?: string[]; status?: 'active' | 'error' } = {}) {
  return prisma.integrationToken.create({
    data: {
      orgId: opts.org ?? orgId,
      userId: opts.user ?? userId,
      provider: IntegrationProvider.microsoft_graph,
      accessTokenEncrypted: encryptToken('access-plain'),
      refreshTokenEncrypted: encryptToken('refresh-plain'),
      scope: opts.scope ?? ['openid', 'offline_access', 'Mail.Read', 'Calendars.Read'],
      status: opts.status ?? 'active',
      errorMessage: opts.status === 'error' ? 'Sync failed. Try again later.' : null,
      lastSyncedAt: new Date('2026-11-06T12:00:00Z'),
    },
  });
}

beforeAll(async () => {
  for (const k of ENV_KEYS) previousEnv[k] = process.env[k];
  process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString('hex');
  process.env.MICROSOFT_GRAPH_CLIENT_ID = 'test-graph-client';
  process.env.MICROSOFT_GRAPH_CLIENT_SECRET = 'test-graph-secret';
  _resetIntegrationTokenKey();
  const org = await createIsolatedOrg('msettings');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  otherOrgId = (await createIsolatedOrg('msettings_other')).orgId;
  server = await buildServer();
  await server.ready();
  userId = (await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } }))!.id;
  otherUserId = (await prisma.user.findFirst({ where: { orgId: otherOrgId }, select: { id: true } }))!.id;
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  if (otherOrgId) await dropIsolatedOrg(otherOrgId);
  for (const k of ENV_KEYS) {
    if (previousEnv[k] === undefined) delete process.env[k];
    else process.env[k] = previousEnv[k];
  }
  _resetIntegrationTokenKey();
});

beforeEach(async () => {
  await prisma.integrationToken.deleteMany({ where: { orgId: { in: [orgId, otherOrgId] } } });
});

describe('GET /settings/microsoft', () => {
  it('reports mail and calendar from the read-only Graph grant', async () => {
    await seedGrant();
    expect(await status()).toMatchObject({
      emailConnected: true,
      calendarConnected: true,
      emailLastSync: '2026-11-06T12:00:00.000Z',
      emailError: null,
    });
  });

  it('reports only what was granted', async () => {
    await seedGrant({ scope: ['openid', 'Mail.Read'] });
    expect(await status()).toMatchObject({ emailConnected: true, calendarConnected: false });
  });

  it('shows the sync error of a broken grant', async () => {
    await seedGrant({ status: 'error' });
    expect(await status()).toMatchObject({ emailConnected: false, emailError: 'Sync failed. Try again later.' });
  });

  it('never reads another org grant', async () => {
    await seedGrant({ org: otherOrgId, user: otherUserId });
    expect(await status()).toMatchObject({ emailConnected: false, calendarConnected: false });
  });
});

describe('POST /settings/microsoft/connect and disconnect', () => {
  it('rejects an unknown service', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/settings/microsoft/connect',
      payload: { service: 'contacts' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns a read-only consent URL', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/settings/microsoft/connect',
      payload: { service: 'calendar' },
    });
    expect(res.statusCode).toBe(200);
    const scope = new URL(res.json<{ authUrl: string }>().authUrl).searchParams.get('scope') ?? '';
    expect(scope).toContain('Calendars.Read');
    expect(scope).not.toMatch(/ReadWrite|Send/);
  });

  it('answers 503 when the OAuth app is not configured', async () => {
    delete process.env.MICROSOFT_GRAPH_CLIENT_ID;
    try {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/settings/microsoft/connect',
        payload: { service: 'email' },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      process.env.MICROSOFT_GRAPH_CLIENT_ID = 'test-graph-client';
    }
  });

  it('disconnects the caller grant only, and a retry is still a success', async () => {
    await seedGrant();
    const foreign = await seedGrant({ org: otherOrgId, user: otherUserId });
    for (let i = 0; i < 2; i += 1) {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/settings/microsoft/disconnect',
        payload: { service: 'email' },
      });
      expect(res.statusCode).toBe(204);
    }
    expect(await status()).toMatchObject({ emailConnected: false });
    const kept = await prisma.integrationToken.findFirst({ where: { id: foreign.id } });
    expect(kept?.status).toBe('active');
  });
});
