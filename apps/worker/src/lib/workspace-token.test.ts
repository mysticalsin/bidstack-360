import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { ProviderRateLimitError } from './provider-http.js';
import { GrantRevokedError, getWorkspaceAccessToken } from './workspace-token.js';

vi.mock('@bidstack/db', () => ({
  prisma: { integrationToken: { update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) } },
}));

vi.mock('@bidstack/shared/token-crypto', () => ({
  encryptToken: (v: string) => `enc(${v})`,
  decryptToken: (v: string) => v.replace(/^enc\((.*)\)$/, '$1'),
}));

const update = vi.mocked(prisma.integrationToken.update);
const updateMany = vi.mocked(prisma.integrationToken.updateMany);
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as pino.Logger;

function row(provider: 'gmail' | 'microsoft_graph' | 'google_workspace', expired = true) {
  return {
    id: 'tok-1',
    orgId: 'org-1',
    provider,
    accessTokenEncrypted: 'enc(old-access)',
    refreshTokenEncrypted: 'enc(old-refresh)',
    expiresAt: new Date(Date.now() + (expired ? -1_000 : 3_600_000)),
    scope: ['https://graph.microsoft.com/Mail.Read', 'https://graph.microsoft.com/Calendars.Read', 'offline_access'],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  process.env.MICROSOFT_GRAPH_CLIENT_ID = 'test-ms-client';
  process.env.MICROSOFT_GRAPH_CLIENT_SECRET = 'test-ms-secret';
  process.env.GMAIL_CLIENT_ID = 'test-google-client';
  process.env.GMAIL_CLIENT_SECRET = 'test-google-secret';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getWorkspaceAccessToken', () => {
  it('returns the stored token while it is still fresh', async () => {
    const fetchImpl = vi.fn();
    await expect(getWorkspaceAccessToken(row('gmail', false), log, fetchImpl)).resolves.toBe('old-access');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refreshes Microsoft with the scopes the user granted and stores the rotated refresh token', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }),
    );
    await expect(getWorkspaceAccessToken(row('microsoft_graph'), log, fetchImpl)).resolves.toBe('new-access');

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get('scope')).toContain('Calendars.Read');
    expect(body.get('scope')).not.toContain('Mail.Send');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tok-1', deletedAt: null },
        data: expect.objectContaining({
          accessTokenEncrypted: 'enc(new-access)',
          refreshTokenEncrypted: 'enc(new-refresh)',
          status: 'active',
        }),
      }),
    );
  });

  it('refreshes Google rows through the Google token endpoint', async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: 'g-access', expires_in: 3600 }));
    await getWorkspaceAccessToken(row('gmail'), log, fetchImpl);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://oauth2.googleapis.com/token');
  });

  it('does not revive a grant disconnected while the refresh was in flight', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const fetchImpl = vi.fn(async () => json({ access_token: 'late-access', expires_in: 3600 }));
    await expect(getWorkspaceAccessToken(row('gmail'), log, fetchImpl)).rejects.toBeInstanceOf(GrantRevokedError);
  });

  it('marks the grant revoked when the provider answers invalid_grant', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'invalid_grant' }, 400));
    await expect(getWorkspaceAccessToken(row('gmail'), log, fetchImpl)).rejects.toBeInstanceOf(GrantRevokedError);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'revoked', errorMessage: expect.stringMatching(/reconnect/i) }),
      }),
    );
  });

  it('keeps Retry-After when the refresh itself is throttled', async () => {
    const fetchImpl = vi.fn(async () => new Response('slow', { status: 429, headers: { 'Retry-After': '12' } }));
    await expect(getWorkspaceAccessToken(row('microsoft_graph'), log, fetchImpl)).rejects.toMatchObject({
      name: 'ProviderRateLimitError',
      retryAfterMs: 12_000,
    });
    expect(update).not.toHaveBeenCalled();
    await expect(getWorkspaceAccessToken(row('microsoft_graph'), log, fetchImpl)).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it('marks a transient provider failure as error, not revoked', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 502 }));
    await expect(getWorkspaceAccessToken(row('microsoft_graph'), log, fetchImpl)).rejects.toThrow(/502/);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'error' }) }),
    );
  });
});
