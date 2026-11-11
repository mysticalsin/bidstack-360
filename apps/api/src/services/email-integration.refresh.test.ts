// WHY: the mailbox refresh wrote `active` by id. A revoke that landed while
// the provider call was in flight was revived, including onto a tombstone.
// The same from-state guard as the worker: only `active` or `error`, and not deleted.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { status: 'active' as string, access: 'enc(old)' };

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({
  prisma: { integrationToken: { updateMany: mocks.updateMany, findFirst: vi.fn() } },
}));

vi.mock('@bidstack/shared/token-crypto', () => ({
  encryptToken: (value: string) => `enc(${value})`,
  decryptToken: (value: string) => value.replace(/^enc\((.*)\)$/, '$1'),
}));

vi.mock('../lib/fetch-timeout.js', () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
  providerTimeoutMs: () => 1_000,
}));

vi.mock('../lib/oauth-refresh-lock.js', () => ({
  runWithOAuthRefreshLock: async ({ refresh }: { refresh: () => Promise<string> }) => refresh(),
}));

import { GrantRevokedError } from '@bidstack/shared';

import { getAccessToken } from './email-integration.helpers.js';

const log = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  state.status = 'active';
  state.access = 'enc(old)';
  mocks.updateMany.mockImplementation(async (args: {
    where: { deletedAt?: Date | null; status?: { in?: string[] } };
    data: { status?: string; accessTokenEncrypted?: string };
  }) => {
    const from = args.where.status?.in;
    if (args.where.deletedAt !== null) return { count: 0 };
    // A missing from-list is the bug: the write lands on whatever row is there.
    if (!from) {
      if (args.data.status) state.status = args.data.status;
      if (args.data.accessTokenEncrypted) state.access = args.data.accessTokenEncrypted;
      return { count: 1 };
    }
    if (!from.includes(state.status)) return { count: 0 };
    if (args.data.status) state.status = args.data.status;
    if (args.data.accessTokenEncrypted) state.access = args.data.accessTokenEncrypted;
    return { count: 1 };
  });
  mocks.fetchWithTimeout.mockResolvedValue(
    new Response(JSON.stringify({ access_token: 'new-access', expires_in: 3600 }), { status: 200 }),
  );
});

const expired = {
  id: 'tok-1',
  orgId: 'org-1',
  accessTokenEncrypted: 'enc(old)',
  refreshTokenEncrypted: 'enc(refresh)',
  expiresAt: new Date(Date.now() - 60_000),
  provider: 'gmail',
  scope: [] as string[],
};

describe('mailbox refresh versus revoke', () => {
  it('refuses a grant whose status is expired without calling the provider', async () => {
    // WHY: the status column `expired` is a refusal. The fixture named
    // `expired` below is only past expiresAt and must still refresh.
    await expect(getAccessToken({ ...expired, status: 'expired' }, log)).rejects.toThrow(
      /status is expired/,
    );
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('stores the new token when the grant is still active', async () => {
    await expect(getAccessToken(expired, log)).resolves.toBe('new-access');
    expect(state.status).toBe('active');
  });

  it('does not revive a revoked grant', async () => {
    state.status = 'revoked';
    await expect(getAccessToken(expired, log)).rejects.toBeInstanceOf(GrantRevokedError);
    expect(state.status).toBe('revoked');
    expect(state.access).toBe('enc(old)');
  });

  it('reports a missing refresh token as a revoked grant', async () => {
    await expect(getAccessToken({ ...expired, refreshTokenEncrypted: null }, log)).rejects.toBeInstanceOf(
      GrantRevokedError,
    );
  });
});
