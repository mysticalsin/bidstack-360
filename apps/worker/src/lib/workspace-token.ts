/**
 * Live access tokens for Google and Microsoft grants, refreshed when they are
 * about to expire.
 *
 * - Rotated refresh tokens are stored (Microsoft rotates on every refresh).
 * - Microsoft refreshes ask for the read scopes the user granted; send and
 *   write scopes from an older grant are dropped, never requested.
 * - invalid_grant means the user revoked access at the provider: the row is
 *   marked revoked with a reconnect hint and sync stops for it.
 */
import IORedis from 'ioredis';
import type pino from 'pino';

import { prisma } from '@bidstack/db';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';
import {
  GrantRevokedError,
  microsoftRefreshScopes,
  runWithOAuthRefreshLock,
  tokenFrom,
  type OAuthRefreshLockRedis,
} from '@bidstack/shared';

export { GrantRevokedError };

const EXPIRY_SKEW_MS = 60_000;
const REFRESH_TIMEOUT_MS = 15_000;

export const REVOKED_MESSAGE = 'Access was revoked at the provider. Reconnect to resume sync.';

/** Columns needed to use or refresh a grant. */
export interface WorkspaceTokenRow {
  id: string;
  orgId: string;
  provider: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
  scope: string[];
  /** Omitted by callers that have not loaded the column. `expired` refuses a refresh. */
  status?: string;
}

function isGoogle(provider: string): boolean {
  return provider === 'gmail' || provider === 'google_workspace';
}

function refreshRequest(row: WorkspaceTokenRow, refreshToken: string): { url: string; body: URLSearchParams } {
  if (isGoogle(row.provider)) {
    return {
      url: 'https://oauth2.googleapis.com/token',
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
        client_secret: process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    };
  }
  const scope = microsoftRefreshScopes(row.scope);
  return {
    url: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}/oauth2/v2.0/token`,
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_GRAPH_CLIENT_ID ?? '',
      client_secret: process.env.MICROSOFT_GRAPH_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: scope.join(' '),
    }),
  };
}

async function readError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? null;
  } catch {
    return null;
  }
}

async function warnIllegalToken(
  id: string,
  to: 'active' | 'revoked' | 'error',
  log: pino.Logger,
): Promise<void> {
  const current = await prisma.integrationToken.findFirst({
    where: { id },
    select: { status: true },
  });
  log.warn(
    { tokenId: id, from: current?.status ?? null, to },
    'illegal integration token transition',
  );
}

/** A failed refresh may leave `revoked` or `error`. It must not rewrite a tombstone, and it does not set `active`. */
async function markToken(
  id: string,
  data: { status: 'revoked' | 'error'; errorMessage: string },
  log: pino.Logger,
): Promise<void> {
  const moved = await prisma.integrationToken.updateMany({
    where: {
      id,
      deletedAt: null,
      status: { in: [...tokenFrom(data.status === 'revoked' ? 'revoke' : 'refresh_fail')] },
    },
    data,
  });
  if (moved.count === 0) await warnIllegalToken(id, data.status, log);
}

let refreshClient: IORedis | null = null;

/**
 * One cold client must not open a second connection while the first is still
 * starting. A second `connect()` throws, and a false ready() would take the
 * in-process lock beside a Redis holder. A refused connect stays unready.
 */
export function workerRefreshLockReady(client: {
  readonly status: string;
  connect: () => Promise<unknown>;
}): () => Promise<boolean> {
  let connecting: Promise<unknown> | null = null;
  return async () => {
    try {
      if (client.status === 'ready' || client.status === 'connect') return true;
      connecting ??= client.connect().finally(() => {
        connecting = null;
      });
      await connecting;
      return client.status === 'ready' || client.status === 'connect';
    } catch {
      return false;
    }
  };
}

/** The worker's Redis, so this process takes the same lock as the API. Tests use the in-process fallback. */
function refreshLockRedis(): OAuthRefreshLockRedis | null {
  if (process.env.NODE_ENV === 'test' || !process.env.REDIS_URL) return null;
  if (!refreshClient) {
    refreshClient = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }
  const client = refreshClient;
  return {
    ready: workerRefreshLockReady({
      get status() {
        return client.status as string;
      },
      connect: () => client.connect(),
    }),
    set: (key, value, expiryMode, ttlMs, condition) => client.set(key, value, expiryMode, ttlMs, condition),
    eval: (script, numKeys, key, owner) => client.eval(script, numKeys, key, owner),
  };
}

async function readGrant(id: string, orgId: string): Promise<WorkspaceTokenRow | null> {
  return prisma.integrationToken.findFirst({
    where: { id, orgId, deletedAt: null },
    select: {
      id: true,
      orgId: true,
      provider: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      expiresAt: true,
      scope: true,
      status: true,
    },
  });
}

/** Return a usable access token, refreshing and persisting it when needed. */
export async function getWorkspaceAccessToken(
  row: WorkspaceTokenRow,
  log: pino.Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  // `expired` is the status column. A past expiresAt with status active still refreshes.
  if (row.status === 'expired') {
    throw new GrantRevokedError('Grant status is expired');
  }
  const fresh = row.expiresAt ? row.expiresAt.getTime() > Date.now() + EXPIRY_SKEW_MS : true;
  if (fresh) return decryptToken(row.accessTokenEncrypted);
  if (!row.refreshTokenEncrypted) {
    await markToken(row.id, { status: 'revoked', errorMessage: REVOKED_MESSAGE }, log);
    throw new GrantRevokedError('Access token expired and no refresh token is stored');
  }

  return runWithOAuthRefreshLock({
    tokenId: row.id,
    log,
    redis: refreshLockRedis(),
    redisRequired:
      process.env.NODE_ENV === 'production' &&
      process.env.OAUTH_REFRESH_LOCK_REDIS_REQUIRED !== 'false',
    getFreshValue: async () => {
      const current = await readGrant(row.id, row.orgId);
      if (!current || current.status !== 'active' || !current.accessTokenEncrypted) return null;
      const stillFresh = current.expiresAt
        ? current.expiresAt.getTime() > Date.now() + EXPIRY_SKEW_MS
        : true;
      if (!stillFresh) return null;
      return decryptToken(current.accessTokenEncrypted);
    },
    refresh: () => refreshGrant(row, log, fetchImpl),
  });
}

async function refreshGrant(
  row: WorkspaceTokenRow,
  log: pino.Logger,
  fetchImpl: typeof fetch,
): Promise<string> {
  const current = (await readGrant(row.id, row.orgId)) ?? row;
  if (!current.refreshTokenEncrypted) {
    await markToken(row.id, { status: 'revoked', errorMessage: REVOKED_MESSAGE }, log);
    throw new GrantRevokedError('Access token expired and no refresh token is stored');
  }

  const { url, body } = refreshRequest(current, decryptToken(current.refreshTokenEncrypted));
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const code = res.status === 400 || res.status === 401 ? await readError(res) : null;
    if (code === 'invalid_grant' || code === 'unauthorized_client') {
      log.warn({ tokenId: row.id, provider: row.provider }, 'workspace grant revoked at provider');
      await markToken(row.id, { status: 'revoked', errorMessage: REVOKED_MESSAGE }, log);
      throw new GrantRevokedError(`${row.provider} refresh rejected: ${code}`);
    }
    log.error({ tokenId: row.id, provider: row.provider, status: res.status }, 'workspace token refresh failed');
    await markToken(
      row.id,
      { status: 'error', errorMessage: `Token refresh failed (${res.status}). Polo will retry.` },
      log,
    );
    throw new Error(`${row.provider} token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  // A disconnect can land while the refresh is in flight; never write fresh tokens onto the tombstone.
  const stored = await prisma.integrationToken.updateMany({
    where: { id: row.id, deletedAt: null, status: { in: [...tokenFrom('refresh_ok')] } },
    data: {
      accessTokenEncrypted: encryptToken(data.access_token),
      ...(data.refresh_token ? { refreshTokenEncrypted: encryptToken(data.refresh_token) } : {}),
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      status: 'active',
      lastRefreshedAt: new Date(),
      errorMessage: null,
    },
  });
  if (stored.count === 0) {
    await warnIllegalToken(row.id, 'active', log);
    throw new GrantRevokedError('Grant was disconnected during refresh');
  }
  return data.access_token;
}
