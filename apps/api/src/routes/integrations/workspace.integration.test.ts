/**
 * Workspace accounts (Google Workspace, Microsoft 365): one status card per
 * provider, read-only consent, encrypted tokens, provider-side revocation.
 * Every provider call is mocked; no real account is ever contacted.
 */
import { randomBytes } from 'node:crypto';

import { IntegrationProvider, prisma } from '@bidstack/db';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';
import { _resetIntegrationTokenKey } from '@bidstack/shared/server-crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/fetch-timeout.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWithTimeout: vi.fn(),
}));

vi.mock('../../queues/email-outlook.js', () => ({
  outlookHistoricalQueue: { add: vi.fn(async () => undefined) },
}));

import { fetchWithTimeout } from '../../lib/fetch-timeout.js';
import { buildServer } from '../../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../../test-support/isolated-org.js';

const mockedFetch = vi.mocked(fetchWithTimeout);
const ENV_KEYS = [
  'INTEGRATION_TOKEN_KEY',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'MICROSOFT_GRAPH_CLIENT_ID',
  'MICROSOFT_GRAPH_CLIENT_SECRET',
] as const;
const previousEnv: Record<string, string | undefined> = {};

let server: FastifyInstance;
let orgId = '';
let otherOrgId = '';
let userId = '';
let restoreAuth: (() => void) | null = null;

interface Card {
  provider: 'google' | 'microsoft';
  configured: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'revoked';
  accountEmail: string | null;
  scopes: Array<{ key: string; label: string; access: 'read' | 'write' }>;
  lastSyncedAt: string | null;
  errorMessage: string | null;
}

async function cards(): Promise<Card[]> {
  const res = await server.inject({ method: 'GET', url: '/api/v1/integrations/workspace' });
  expect(res.statusCode).toBe(200);
  return res.json<{ providers: Card[] }>().providers;
}

beforeAll(async () => {
  for (const k of ENV_KEYS) previousEnv[k] = process.env[k];
  process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString('hex');
  process.env.GMAIL_CLIENT_ID = 'test-google-client';
  process.env.GMAIL_CLIENT_SECRET = 'test-google-secret';
  process.env.MICROSOFT_GRAPH_CLIENT_ID = 'test-graph-client';
  process.env.MICROSOFT_GRAPH_CLIENT_SECRET = 'test-graph-secret';
  _resetIntegrationTokenKey();

  const org = await createIsolatedOrg('workspace');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const other = await createIsolatedOrg('workspace_other');
  otherOrgId = other.orgId;
  server = await buildServer();
  await server.ready();

  // Stub auth resolves the earliest user of the org.
  const me = await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  userId = me!.id;
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
  mockedFetch.mockReset();
  await prisma.integrationToken.deleteMany({ where: { orgId: { in: [orgId, otherOrgId] } } });
});

async function seedToken(
  provider: IntegrationProvider,
  opts: { org?: string; user?: string; scope?: string[]; status?: 'active' | 'error' | 'revoked' } = {},
) {
  return prisma.integrationToken.create({
    data: {
      orgId: opts.org ?? orgId,
      userId: opts.user ?? userId,
      provider,
      accessTokenEncrypted: encryptToken('access-plain'),
      refreshTokenEncrypted: encryptToken('refresh-plain'),
      scope: opts.scope ?? [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.readonly',
      ],
      status: opts.status ?? 'active',
      externalAccountEmail: 'tony@example.test',
      lastSyncedAt: new Date('2026-11-06T12:00:00Z'),
    },
  });
}

describe('GET /integrations/workspace', () => {
  it('returns one card per provider, disconnected by default', async () => {
    const list = await cards();
    expect(list.map((c) => c.provider)).toEqual(['google', 'microsoft']);
    for (const c of list) {
      expect(c).toMatchObject({ configured: true, status: 'disconnected', accountEmail: null, scopes: [] });
    }
  });

  it('shows status, account, plain-word scopes and last sync for a connected grant', async () => {
    await seedToken(IntegrationProvider.gmail);
    const google = (await cards()).find((c) => c.provider === 'google');
    expect(google).toMatchObject({
      status: 'connected',
      accountEmail: 'tony@example.test',
      lastSyncedAt: '2026-11-06T12:00:00.000Z',
    });
    expect(google?.scopes.map((s) => s.label)).toEqual(['Read your email', 'Read your calendar']);
    expect(JSON.stringify(google)).not.toContain('plain');
  });

  it('reports a revoked grant so the card can offer reconnect', async () => {
    await seedToken(IntegrationProvider.microsoft_graph, { status: 'revoked', scope: ['Mail.Read'] });
    const ms = (await cards()).find((c) => c.provider === 'microsoft');
    expect(ms?.status).toBe('revoked');
  });

  it('marks a provider as not configured when its OAuth app is missing', async () => {
    const saved = process.env.MICROSOFT_GRAPH_CLIENT_ID;
    delete process.env.MICROSOFT_GRAPH_CLIENT_ID;
    try {
      const ms = (await cards()).find((c) => c.provider === 'microsoft');
      expect(ms?.configured).toBe(false);
      const res = await server.inject({ method: 'POST', url: '/api/v1/integrations/workspace/microsoft/connect' });
      expect(res.statusCode).toBe(503);
    } finally {
      process.env.MICROSOFT_GRAPH_CLIENT_ID = saved;
    }
  });

  it('never shows another org grant', async () => {
    const otherUser = await prisma.user.findFirst({ where: { orgId: otherOrgId }, select: { id: true } });
    await seedToken(IntegrationProvider.gmail, { org: otherOrgId, user: otherUser!.id });
    expect((await cards()).every((c) => c.status === 'disconnected')).toBe(true);
  });
});

describe('POST /integrations/workspace/:provider/connect', () => {
  it('asks Google for read-only mail and calendar with offline access', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/integrations/workspace/google/connect' });
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json<{ authUrl: string }>().authUrl);
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(scope).toContain('https://www.googleapis.com/auth/calendar.readonly');
    expect(scope).not.toMatch(/gmail\.send|gmail\.modify|gmail\.compose/);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('asks Microsoft for read-only mail and calendar', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/integrations/workspace/microsoft/connect' });
    expect(res.statusCode).toBe(200);
    const scope = new URL(res.json<{ authUrl: string }>().authUrl).searchParams.get('scope') ?? '';
    expect(scope).toContain('Mail.Read');
    expect(scope).toContain('Calendars.Read');
    expect(scope).toContain('offline_access');
    expect(scope).not.toMatch(/Mail\.Send|ReadWrite/);
  });

  it('keeps an active connection alive while a reconnect is pending', async () => {
    await seedToken(IntegrationProvider.gmail);
    await server.inject({ method: 'POST', url: '/api/v1/integrations/workspace/google/connect' });
    const row = await prisma.integrationToken.findFirst({ where: { orgId, provider: IntegrationProvider.gmail } });
    expect(row?.status).toBe('active');
    expect(decryptToken(row!.accessTokenEncrypted)).toBe('access-plain');
  });

  it('rejects an unknown provider', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/integrations/workspace/yahoo/connect' });
    expect(res.statusCode).toBe(400);
  });

  it('stores tokens encrypted at rest after the Google callback', async () => {
    const start = await server.inject({ method: 'POST', url: '/api/v1/integrations/workspace/google/connect' });
    const state = new URL(start.json<{ authUrl: string }>().authUrl).searchParams.get('state')!;
    mockedFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'access-from-google',
            refresh_token: 'refresh-from-google',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValue(new Response('nope', { status: 500 }));
    const cb = await server.inject({
      method: 'GET',
      url: `/api/v1/integrations/gmail/oauth/callback?code=c&state=${encodeURIComponent(state)}`,
    });
    expect(cb.statusCode).toBe(302);
    const row = await prisma.integrationToken.findFirst({ where: { orgId, provider: IntegrationProvider.gmail } });
    expect(row?.accessTokenEncrypted).not.toContain('access-from-google');
    expect(row?.refreshTokenEncrypted).not.toContain('refresh-from-google');
    expect(decryptToken(row!.refreshTokenEncrypted!)).toBe('refresh-from-google');
  });
});

describe('DELETE /integrations/workspace/:provider', () => {
  it('revokes the Google grant at the provider and wipes the stored secrets', async () => {
    await seedToken(IntegrationProvider.gmail);
    mockedFetch.mockResolvedValue(new Response('', { status: 200 }));
    const res = await server.inject({ method: 'DELETE', url: '/api/v1/integrations/workspace/google' });
    expect(res.statusCode).toBe(204);

    const revokeCall = mockedFetch.mock.calls.find(([u]) => String(u).startsWith('https://oauth2.googleapis.com/revoke'));
    expect(revokeCall).toBeTruthy();
    expect(String((revokeCall![1] as RequestInit).body)).toContain('token=refresh-plain');

    const row = await prisma.integrationToken.findFirst({
      where: { orgId, provider: IntegrationProvider.gmail },
    });
    expect(row?.status).toBe('revoked');
    expect(row?.refreshTokenEncrypted).toBeNull();
    expect(decryptToken(row!.accessTokenEncrypted)).not.toBe('access-plain');
    expect((await cards()).find((c) => c.provider === 'google')?.status).toBe('disconnected');
  });

  it('still disconnects locally when the provider revoke call fails', async () => {
    await seedToken(IntegrationProvider.microsoft_graph, { scope: ['Mail.Read', 'Calendars.Read'] });
    mockedFetch.mockRejectedValue(new Error('network down'));
    const res = await server.inject({ method: 'DELETE', url: '/api/v1/integrations/workspace/microsoft' });
    expect(res.statusCode).toBe(204);
    expect((await cards()).find((c) => c.provider === 'microsoft')?.status).toBe('disconnected');
  });

  it('allows a reconnect after a disconnect', async () => {
    await seedToken(IntegrationProvider.gmail);
    mockedFetch.mockResolvedValue(new Response('', { status: 200 }));
    await server.inject({ method: 'DELETE', url: '/api/v1/integrations/workspace/google' });
    const res = await server.inject({ method: 'POST', url: '/api/v1/integrations/workspace/google/connect' });
    expect(res.statusCode).toBe(200);
    const legacy = await server.inject({ method: 'GET', url: '/api/v1/integrations/gmail/oauth/start' });
    expect(legacy.statusCode).toBe(200);
  });

  it('is idempotent when nothing is connected', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await server.inject({ method: 'DELETE', url: '/api/v1/integrations/workspace/google' });
      expect(res.statusCode).toBe(204);
    }
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('never touches another org grant', async () => {
    const otherUser = await prisma.user.findFirst({ where: { orgId: otherOrgId }, select: { id: true } });
    const foreign = await seedToken(IntegrationProvider.gmail, { org: otherOrgId, user: otherUser!.id });
    await server.inject({ method: 'DELETE', url: '/api/v1/integrations/workspace/google' });
    const row = await prisma.integrationToken.findUnique({ where: { id: foreign.id } });
    expect(row?.status).toBe('active');
  });
});
