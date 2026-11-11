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
import type pino from 'pino';

import { prisma } from '@bidstack/db';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';
import { microsoftRefreshScopes } from '@bidstack/shared';

const EXPIRY_SKEW_MS = 60_000;
const REFRESH_TIMEOUT_MS = 15_000;

export const REVOKED_MESSAGE = 'Access was revoked at the provider. Reconnect to resume sync.';

/** The provider no longer honours this grant; the user must reconnect. */
export class GrantRevokedError extends Error {
  override readonly name = 'GrantRevokedError';
}

/** Columns needed to use or refresh a grant. */
export interface WorkspaceTokenRow {
  id: string;
  orgId: string;
  provider: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
  scope: string[];
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

/** Refresh may leave `active` or `error`. It must not rewrite `revoked` or a tombstone. */
async function markToken(
  id: string,
  data: { status: 'active' | 'revoked' | 'error'; errorMessage: string },
  log: pino.Logger,
): Promise<void> {
  const moved = await prisma.integrationToken.updateMany({
    where: { id, deletedAt: null, status: { in: ['active', 'error'] } },
    data,
  });
  if (moved.count === 0) {
    log.warn({ tokenId: id, to: data.status }, 'illegal integration token transition');
  }
}

/** Return a usable access token, refreshing and persisting it when needed. */
export async function getWorkspaceAccessToken(
  row: WorkspaceTokenRow,
  log: pino.Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const fresh = row.expiresAt ? row.expiresAt.getTime() > Date.now() + EXPIRY_SKEW_MS : true;
  if (fresh) return decryptToken(row.accessTokenEncrypted);
  if (!row.refreshTokenEncrypted) {
    await markToken(row.id, { status: 'revoked', errorMessage: REVOKED_MESSAGE }, log);
    throw new GrantRevokedError('Access token expired and no refresh token is stored');
  }

  const { url, body } = refreshRequest(row, decryptToken(row.refreshTokenEncrypted));
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
    where: { id: row.id, deletedAt: null, status: { in: ['active', 'error'] } },
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
    log.warn({ tokenId: row.id, to: 'active' }, 'illegal integration token transition');
    throw new GrantRevokedError('Grant was disconnected during refresh');
  }
  return data.access_token;
}
