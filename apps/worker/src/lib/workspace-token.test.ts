import IORedis from 'ioredis';
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import { OAuthRefreshLockUnavailableError } from '@bidstack/shared/server';

import {
  GrantRevokedError,
  getWorkspaceAccessToken,
  refreshLockRedis,
  workerRefreshLockReady,
} from './workspace-token.js';

vi.mock('@bidstack/db', () => ({
  prisma: {
    integrationToken: {
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => ({
        id: 'tok-1',
        orgId: 'org-1',
        provider: grant.provider,
        status: grant.status,
        accessTokenEncrypted: grant.access,
        refreshTokenEncrypted: grant.refresh,
        expiresAt: grant.expiresAt,
        scope: [
          'https://graph.microsoft.com/Mail.Read',
          'https://graph.microsoft.com/Calendars.Read',
          'offline_access',
        ],
      })),
    },
  },
}));

vi.mock('@bidstack/shared/token-crypto', () => ({
  encryptToken: (v: string) => `enc(${v})`,
  decryptToken: (v: string) => v.replace(/^enc\((.*)\)$/, '$1'),
}));

const updateMany = vi.mocked(prisma.integrationToken.updateMany);
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as pino.Logger;
const grant = {
  status: 'active',
  access: 'enc(old-access)',
  refresh: 'enc(old-refresh)',
  expiresAt: new Date(Date.now() - 1_000),
  provider: 'gmail' as 'gmail' | 'microsoft_graph' | 'google_workspace',
};

function row(provider: 'gmail' | 'microsoft_graph' | 'google_workspace', expired = true) {
  grant.provider = provider;
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
  grant.status = 'active';
  grant.access = 'enc(old-access)';
  grant.refresh = 'enc(old-refresh)';
  grant.expiresAt = new Date(Date.now() - 1_000);
  grant.provider = 'gmail';
  updateMany.mockImplementation(async (args: {
    where: { status?: { in?: string[] } };
    data: {
      status?: string;
      accessTokenEncrypted?: string;
      refreshTokenEncrypted?: string;
      expiresAt?: Date | null;
    };
  }) => {
    const from = args.where.status?.in;
    const apply = () => {
      if (args.data.status) grant.status = args.data.status;
      if (args.data.accessTokenEncrypted) grant.access = args.data.accessTokenEncrypted;
      if (args.data.refreshTokenEncrypted) grant.refresh = args.data.refreshTokenEncrypted;
      if (args.data.expiresAt) grant.expiresAt = args.data.expiresAt;
    };
    // A missing from-list is the bug: the write lands on the current row.
    if (!from) {
      apply();
      return { count: 1 };
    }
    if (!from.includes(grant.status)) return { count: 0 };
    apply();
    return { count: 1 };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getWorkspaceAccessToken', () => {
  it('does not call the provider when NODE_ENV is missing and Redis is down', async () => {
    // WHY: the worker treated a missing NODE_ENV as "Redis optional", so each
    // process refreshed with the same token. Redis is required unless this
    // process is development or test and opts out.
    const previousEnv = process.env.NODE_ENV;
    const previousUrl = process.env.REDIS_URL;
    const previousFlag = process.env.OAUTH_REFRESH_LOCK_REDIS_REQUIRED;
    delete process.env.NODE_ENV;
    delete process.env.REDIS_URL;
    delete process.env.OAUTH_REFRESH_LOCK_REDIS_REQUIRED;
    const fetchImpl = vi.fn();
    try {
      await expect(getWorkspaceAccessToken(row('gmail'), log, fetchImpl)).rejects.toBeInstanceOf(
        OAuthRefreshLockUnavailableError,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousEnv;
      if (previousUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousUrl;
      if (previousFlag === undefined) delete process.env.OAUTH_REFRESH_LOCK_REDIS_REQUIRED;
      else process.env.OAUTH_REFRESH_LOCK_REDIS_REQUIRED = previousFlag;
    }
  });

  it('refuses a grant whose status is expired, and still refreshes one that is only past its expiry time', async () => {
    // WHY: `expired` is the status column. A clock that has passed expiresAt,
    // while the status is still active, is the normal refresh.
    const blocked = vi.fn(async () => json({ access_token: 'new-access', expires_in: 3600 }));
    await expect(
      getWorkspaceAccessToken({ ...row('gmail'), status: 'expired' }, log, blocked),
    ).rejects.toBeInstanceOf(GrantRevokedError);
    expect(blocked).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();

    const allowed = vi.fn(async () => json({ access_token: 'new-access', expires_in: 3600 }));
    await expect(
      getWorkspaceAccessToken({ ...row('gmail'), status: 'active' }, log, allowed),
    ).resolves.toBe('new-access');
    expect(allowed).toHaveBeenCalledOnce();
  });

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
    expect(grant.status).toBe('active');
    expect(grant.access).toBe('enc(new-access)');
  });

  it('refreshes Google rows through the Google token endpoint', async () => {
    const fetchImpl = vi.fn(async () => json({ access_token: 'g-access', expires_in: 3600 }));
    await getWorkspaceAccessToken(row('gmail'), log, fetchImpl);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://oauth2.googleapis.com/token');
  });

  it('does not revive a grant disconnected while the refresh was in flight', async () => {
    // WHY: the provider answers after the grant is revoked. The mock applies a
    // write that has no from-list, so this fails if refresh stores the new
    // access token onto whatever row is there.
    const fetchImpl = vi.fn(async () => {
      grant.status = 'revoked';
      return json({ access_token: 'late-access', expires_in: 3600 });
    });
    await expect(getWorkspaceAccessToken(row('gmail'), log, fetchImpl)).rejects.toBeInstanceOf(
      GrantRevokedError,
    );
    expect(grant.status).toBe('revoked');
    expect(grant.access).toBe('enc(old-access)');
  });

  it('marks the grant revoked when the provider answers invalid_grant', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'invalid_grant' }, 400));
    await expect(getWorkspaceAccessToken(row('gmail'), log, fetchImpl)).rejects.toBeInstanceOf(GrantRevokedError);
    expect(grant.status).toBe('revoked');
    expect(grant.access).toBe('enc(old-access)');
  });

  it('does not store a fresh token onto a revoked grant', async () => {
    grant.status = 'revoked';
    const fetchImpl = vi.fn(async () => json({ access_token: 'late-access', expires_in: 3600 }));
    await expect(getWorkspaceAccessToken(row('gmail'), log, fetchImpl)).rejects.toBeInstanceOf(GrantRevokedError);
    expect(grant.status).toBe('revoked');
    expect(grant.access).toBe('enc(old-access)');
  });

  it('keeps a rotated Microsoft refresh token when the overlapping call is rejected', async () => {
    // WHY: Microsoft invalidates the previous refresh token. If that rejection
    // is applied after the winner has already rotated, the grant is revoked
    // and the new ciphertext is thrown away.
    let calls = 0;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await held;
        return json({ access_token: 'new-access', refresh_token: 'rotated', expires_in: 3600 });
      }
      return json({ error: 'invalid_grant' }, 400);
    });
    const first = getWorkspaceAccessToken(row('microsoft_graph'), log, fetchImpl);
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = getWorkspaceAccessToken(row('microsoft_graph'), log, fetchImpl);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual(['new-access', 'new-access']);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(grant.status).toBe('active');
    expect(grant.refresh).toBe('enc(rotated)');
    expect(grant.access).toBe('enc(new-access)');
  });

  it('does not send a second Microsoft refresh while the first one is still in flight', async () => {
    // WHY: Microsoft rotates the refresh token. A second call with the old
    // token is invalid_grant, and the status predicate then revokes the grant
    // that the first call just stored.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await gate;
      return json({ access_token: 'new-access', refresh_token: 'rotated', expires_in: 3600 });
    });
    const first = getWorkspaceAccessToken(row('microsoft_graph'), log, fetchImpl);
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = getWorkspaceAccessToken(row('microsoft_graph'), log, fetchImpl);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(['new-access', 'new-access']);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(grant.status).toBe('active');
  });

  it('shares one cold Redis connect across refresh callers', async () => {
    // WHY: ioredis rejects a second connect() while the first is starting.
    // Each rejection used to look like Redis being down, so those callers
    // took the in-process lock beside the caller that held the Redis key.
    let connects = 0;
    let status = 'wait';
    const ready = workerRefreshLockReady({
      get status() {
        return status;
      },
      async connect() {
        connects += 1;
        if (status === 'connecting') throw new Error('Redis is already connecting');
        status = 'connecting';
        await new Promise((resolve) => setTimeout(resolve, 40));
        status = 'ready';
      },
    });
    await expect(Promise.all([ready(), ready(), ready()])).resolves.toEqual([true, true, true]);
    expect(connects).toBe(1);
  });

  it('shares one cold connect when each caller opens the lock itself', async () => {
    // WHY: refreshLockRedis() used to build a new readiness closure on every
    // call. Four cold callers then each called connect(), and the ones that
    // lost the race refreshed without the Redis lock.
    let connects = 0;
    let status = 'wait';
    const client = {
      get status() {
        return status;
      },
      async connect() {
        connects += 1;
        if (status === 'connecting') throw new Error('Redis is already connecting');
        status = 'connecting';
        await new Promise((resolve) => setTimeout(resolve, 40));
        status = 'ready';
      },
    };
    const ready = [0, 1, 2, 3].map(() => refreshLockRedis(client)!.ready);
    await expect(Promise.all(ready.map((run) => run()))).resolves.toEqual([true, true, true, true]);
    expect(connects).toBe(1);
  });

  it('a refused Redis connect stays unready', async () => {
    // WHY: production still requires Redis. A connect that fails must not
    // report ready and refresh without the lock.
    const ready = workerRefreshLockReady({
      status: 'wait',
      connect: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(await ready()).toBe(false);
  });

  it('listens for errors on the refresh Redis client', () => {
    // WHY: ioredis prints "Unhandled error" when this client has no error
    // listener. The API client swallows that event; this one must too.
    const on = vi.spyOn(IORedis.prototype, 'on');
    const previousEnv = process.env.NODE_ENV;
    const previousUrl = process.env.REDIS_URL;
    process.env.NODE_ENV = 'development';
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    try {
      refreshLockRedis();
      expect(on.mock.calls.some((call) => call[0] === 'error' && typeof call[1] === 'function')).toBe(
        true,
      );
    } finally {
      process.env.NODE_ENV = previousEnv;
      if (previousUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousUrl;
      for (const instance of on.mock.instances) instance.disconnect();
      on.mockRestore();
    }
  });

  it('marks a transient provider failure as error, not revoked', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 502 }));
    await expect(getWorkspaceAccessToken(row('microsoft_graph'), log, fetchImpl)).rejects.toThrow(/502/);
    expect(grant.status).toBe('error');
    expect(grant.access).toBe('enc(old-access)');
  });
});
