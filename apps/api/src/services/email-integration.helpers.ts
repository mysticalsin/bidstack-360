/**
 * Email integration — shared types, token-refresh helpers, and pixel injection.
 *
 * Imported by:
 *   email-integration.gmail.ts  — Gmail send + pull
 *   email-integration.graph.ts  — MS Graph send + pull
 *   email-integration.service.ts — public API orchestrators
 */

import { prisma } from '@bidstack/db';
import { GrantRevokedError, microsoftRefreshScopes, tokenFrom } from '@bidstack/shared';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';
import type pino from 'pino';
import { fetchWithTimeout, providerTimeoutMs } from '../lib/fetch-timeout.js';
import { runWithOAuthRefreshLock } from '../lib/oauth-refresh-lock.js';

export type ServiceLogger = Pick<pino.Logger, 'debug' | 'error' | 'info' | 'warn'>;

function oauthTimeoutMs(): number {
  return providerTimeoutMs('OAUTH_HTTP_TIMEOUT_MS', 15_000);
}

function tokenExpiresSoon(expiresAt: Date | null): boolean {
  return expiresAt ? expiresAt.getTime() < Date.now() + 60_000 : false;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface SendEmailParams {
  orgId: string;
  userId: string;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  entityType?: string;
  entityId?: string;
}

export interface PullEmailsParams {
  orgId: string;
  userId: string;
  integrationTokenId: string;
  since?: Date;
}

export interface GmailMessage {
  id: string;
  threadId: string;
}

// ─── Token refresh ─────────────────────────────────────────────────────────────

const REVOKED_MESSAGE = 'Access was revoked at the provider. Reconnect to resume sync.';

/**
 * Exchange a refresh token. Stores rotated refresh tokens (Microsoft rotates
 * on every refresh), asks Microsoft only for the read scopes the user granted, and
 * marks the grant revoked on invalid_grant so the card offers a reconnect.
 */
async function refreshToken(
  token: { id: string; provider: string; scope: string[] },
  refresh: string,
  log: ServiceLogger,
): Promise<string> {
  const google = token.provider === 'gmail' || token.provider === 'google_workspace';
  const url = google
    ? 'https://oauth2.googleapis.com/token'
    : `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}/oauth2/v2.0/token`;
  const body = google
    ? new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
        client_secret: process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
        refresh_token: refresh,
        grant_type: 'refresh_token',
      })
    : new URLSearchParams({
        client_id: process.env.MICROSOFT_GRAPH_CLIENT_ID ?? '',
        client_secret: process.env.MICROSOFT_GRAPH_CLIENT_SECRET ?? '',
        refresh_token: refresh,
        grant_type: 'refresh_token',
        scope: microsoftRefreshScopes(token.scope).join(' '),
      });

  const res = await fetchWithTimeout(url, {
    provider: google ? 'Gmail' : 'Microsoft Graph',
    operation: 'oauth.refresh',
    timeoutMs: oauthTimeoutMs(),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    let code: string | undefined;
    try {
      code = ((await res.json()) as { error?: string }).error;
    } catch {
      code = undefined;
    }
    const revoked = code === 'invalid_grant' || code === 'unauthorized_client';
    log.error({ tokenId: token.id, status: res.status, code }, 'OAuth token refresh failed');
    await markIntegrationToken(
      token.id,
      revoked
        ? { status: 'revoked', errorMessage: REVOKED_MESSAGE }
        : { status: 'error', errorMessage: `Token refresh failed (${res.status}). Polo will retry.` },
      log,
    );
    throw new Error(`${google ? 'Gmail' : 'MS Graph'} refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const stored = await prisma.integrationToken.updateMany({
    where: { id: token.id, deletedAt: null, status: { in: [...tokenFrom('refresh_ok')] } },
    data: {
      accessTokenEncrypted: encryptToken(data.access_token),
      ...(data.refresh_token ? { refreshTokenEncrypted: encryptToken(data.refresh_token) } : {}),
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      status: 'active',
      lastRefreshedAt: new Date(),
      errorMessage: null,
    },
  });
  if (stored.count !== 1) {
    const current = await prisma.integrationToken.findFirst({
      where: { id: token.id },
      select: { status: true },
    });
    log.warn(
      { tokenId: token.id, from: current?.status ?? null, to: 'active' },
      'illegal integration token transition',
    );
    throw new GrantRevokedError('Grant was disconnected during refresh');
  }
  return data.access_token;
}

/** A failed refresh may leave `revoked` or `error`. It must not rewrite a tombstone. */
async function markIntegrationToken(
  id: string,
  data: { status: 'revoked' | 'error'; errorMessage: string },
  log: ServiceLogger,
): Promise<void> {
  const moved = await prisma.integrationToken.updateMany({
    where: {
      id,
      deletedAt: null,
      status: { in: [...tokenFrom(data.status === 'revoked' ? 'revoke' : 'refresh_fail')] },
    },
    data,
  });
  if (moved.count === 0) {
    const current = await prisma.integrationToken.findFirst({
      where: { id },
      select: { status: true },
    });
    log.warn(
      { tokenId: id, from: current?.status ?? null, to: data.status },
      'illegal integration token transition',
    );
  }
}

/**
 * Get a live access token, refreshing if expired or within 60-second buffer.
 */
export async function getAccessToken(
  tokenRecord: {
    id: string;
    orgId: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string | null;
    expiresAt: Date | null;
    provider: string;
    scope?: string[];
    /** Omitted when the caller has not loaded the column. `expired` refuses a refresh. */
    status?: string;
  },
  log: ServiceLogger,
): Promise<string> {
  if (tokenRecord.status === 'expired') {
    throw new GrantRevokedError('Grant status is expired');
  }
  if (!tokenExpiresSoon(tokenRecord.expiresAt))
    return decryptToken(tokenRecord.accessTokenEncrypted);

  return runWithOAuthRefreshLock({
    tokenId: tokenRecord.id,
    log,
    getFreshValue: () => getFreshIntegrationAccessToken(tokenRecord.id, tokenRecord.orgId),
    refresh: async () => {
      // The caller may still hold the refresh token from before the lock.
      // The row is the one the previous refresh stored.
      const fresh = await prisma.integrationToken.findFirst({
        where: { id: tokenRecord.id, orgId: tokenRecord.orgId, deletedAt: null },
        select: { refreshTokenEncrypted: true, provider: true, scope: true, status: true },
      });
      if (
        !fresh?.refreshTokenEncrypted ||
        fresh.status === 'expired' ||
        fresh.status === 'revoked'
      ) {
        throw new GrantRevokedError('Token expired and no refresh token available');
      }

      const refresh = decryptToken(fresh.refreshTokenEncrypted);
      return refreshToken(
        { id: tokenRecord.id, provider: fresh.provider, scope: fresh.scope ?? [] },
        refresh,
        log,
      );
    },
  });
}

// WHY findFirst + orgId (not findUnique by id alone): IntegrationToken rows are
// tenant-scoped. Fetching by bare id would let a stale/forged tokenId from one
// org decrypt another org's OAuth credentials — see MISTAKES.md cross-tenant
// token disclosure finding.
async function getFreshIntegrationAccessToken(
  tokenId: string,
  orgId: string,
): Promise<string | null> {
  const token = await prisma.integrationToken.findFirst({
    where: { id: tokenId, orgId },
    select: { accessTokenEncrypted: true, expiresAt: true, status: true },
  });
  if (!token || token.status !== 'active' || tokenExpiresSoon(token.expiresAt)) return null;
  return decryptToken(token.accessTokenEncrypted);
}

// ─── Tracking pixel injection ──────────────────────────────────────────────────

export function injectTrackingPixel(html: string, pixelToken: string, baseUrl: string): string {
  const pixelUrl = `${baseUrl}/track/email/open/${pixelToken}`;
  const pixelTag = `<!-- bidstack-tracking-pixel --><img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`;

  // Inject before </body> if present, otherwise append
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixelTag}</body>`);
  }
  return html + pixelTag;
}
