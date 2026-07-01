// Microsoft Graph token lifecycle.
//
// Responsibilities:
//   - Environment config accessors (clientId, clientSecret, tenant, webhookBaseUrl)
//   - Access token expiry check and proactive refresh via refresh_token grant
//
// Imported by microsoft-graph.service.ts (email + delta) and
// microsoft-graph-subscription.service.ts (subscriptions).

import { prisma } from '@bidstack/db';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';
import type pino from 'pino';
import { fetchWithTimeout, providerTimeoutMs } from '../lib/fetch-timeout.js';
import { runWithOAuthRefreshLock } from '../lib/oauth-refresh-lock.js';

export type ServiceLogger = Pick<pino.Logger, 'debug' | 'error' | 'info' | 'warn'>;

// ─── Constants ────────────────────────────────────────────────────────────────

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_ENDPOINT_BASE = 'https://login.microsoftonline.com';

/** Graph subscription max lifetime in milliseconds (3 days). */
export const SUB_MAX_MS = 3 * 24 * 60 * 60 * 1000;

// ─── Environment accessors ────────────────────────────────────────────────────

export function tenant(): string {
  return process.env.MICROSOFT_TENANT_ID ?? 'common';
}

export function clientId(): string {
  const v = process.env.MICROSOFT_GRAPH_CLIENT_ID;
  if (!v) throw new Error('MICROSOFT_GRAPH_CLIENT_ID is not set');
  return v;
}

export function clientSecret(): string {
  const v = process.env.MICROSOFT_GRAPH_CLIENT_SECRET;
  if (!v) throw new Error('MICROSOFT_GRAPH_CLIENT_SECRET is not set');
  return v;
}

export function webhookBaseUrl(): string {
  const v = process.env.MICROSOFT_WEBHOOK_BASE_URL;
  if (!v) throw new Error('MICROSOFT_WEBHOOK_BASE_URL is not set');
  return v.replace(/\/$/, '');
}

// ─── Token lifecycle ──────────────────────────────────────────────────────────

export type TokenRow = {
  id: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
};

function tokenExpiresSoon(expiresAt: Date | null): boolean {
  return expiresAt ? expiresAt.getTime() < Date.now() + 60_000 : false;
}

/**
 * Returns a live access token for the given token record, refreshing
 * via the OAuth refresh_token grant if the token is within 60 s of expiry.
 */
export async function getAccessToken(row: TokenRow, log: ServiceLogger): Promise<string> {
  if (!tokenExpiresSoon(row.expiresAt)) {
    return decryptToken(row.accessTokenEncrypted);
  }

  return runWithOAuthRefreshLock({
    tokenId: row.id,
    log,
    getFreshValue: () => getFreshMsGraphAccessToken(row.id),
    refresh: async () => {
      if (!row.refreshTokenEncrypted) {
        throw new Error('MS Graph token expired and no refresh token is stored');
      }

      const refreshToken = decryptToken(row.refreshTokenEncrypted);
      return refreshMsGraphToken(row.id, refreshToken, log);
    },
  });
}

async function getFreshMsGraphAccessToken(tokenId: string): Promise<string | null> {
  const token = await prisma.integrationToken.findUnique({
    where: { id: tokenId },
    select: { accessTokenEncrypted: true, expiresAt: true, status: true },
  });
  if (!token || token.status !== 'active' || tokenExpiresSoon(token.expiresAt)) return null;
  return decryptToken(token.accessTokenEncrypted);
}

async function refreshMsGraphToken(
  tokenId: string,
  refreshToken: string,
  log: ServiceLogger,
): Promise<string> {
  const res = await fetchWithTimeout(`${TOKEN_ENDPOINT_BASE}/${tenant()}/oauth2/v2.0/token`, {
    provider: 'Microsoft Graph',
    operation: 'oauth.refresh',
    timeoutMs: providerTimeoutMs('OAUTH_HTTP_TIMEOUT_MS', 15_000),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: [
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/Mail.Read',
        'offline_access',
      ].join(' '),
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error({ tokenId, status: res.status, body }, 'MS Graph token refresh failed');
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: { status: 'error', errorMessage: `refresh_failed:${res.status}` },
    });
    throw new Error(`MS Graph token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined;

  await prisma.integrationToken.update({
    where: { id: tokenId },
    data: {
      accessTokenEncrypted: encryptToken(data.access_token),
      // Entra may rotate the refresh token — always persist the latest
      ...(data.refresh_token ? { refreshTokenEncrypted: encryptToken(data.refresh_token) } : {}),
      expiresAt,
      status: 'active',
      lastRefreshedAt: new Date(),
      errorMessage: null,
    },
  });

  log.debug({ tokenId }, 'MS Graph access token refreshed');
  return data.access_token;
}
