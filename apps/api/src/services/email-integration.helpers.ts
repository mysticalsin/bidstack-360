/**
 * Email integration — shared types, token-refresh helpers, and pixel injection.
 *
 * Imported by:
 *   email-integration.gmail.ts  — Gmail send + pull
 *   email-integration.graph.ts  — MS Graph send + pull
 *   email-integration.service.ts — public API orchestrators
 */

import { prisma } from '@bidstack/db';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';
import type pino from 'pino';

export type ServiceLogger = Pick<pino.Logger, 'debug' | 'error' | 'info' | 'warn'>;

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

export async function refreshGmailToken(
  tokenId: string,
  refreshToken: string,
  log: ServiceLogger,
): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID ?? '',
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error({ tokenId, status: res.status, body }, 'Gmail token refresh failed');
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: { status: 'error', errorMessage: `refresh failed: ${res.status}` },
    });
    throw new Error(`Gmail refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined;

  await prisma.integrationToken.update({
    where: { id: tokenId },
    data: {
      accessTokenEncrypted: encryptToken(data.access_token),
      expiresAt,
      status: 'active',
      lastRefreshedAt: new Date(),
      errorMessage: null,
    },
  });

  return data.access_token;
}

export async function refreshMsGraphToken(
  tokenId: string,
  refreshToken: string,
  log: ServiceLogger,
): Promise<string> {
  const tenant = process.env.MICROSOFT_TENANT_ID ?? 'common';
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_GRAPH_CLIENT_ID ?? '',
      client_secret: process.env.MICROSOFT_GRAPH_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope:
        'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read offline_access',
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error({ tokenId, status: res.status, body }, 'MS Graph token refresh failed');
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: { status: 'error', errorMessage: `refresh failed: ${res.status}` },
    });
    throw new Error(`MS Graph refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined;

  await prisma.integrationToken.update({
    where: { id: tokenId },
    data: {
      accessTokenEncrypted: encryptToken(data.access_token),
      expiresAt,
      status: 'active',
      lastRefreshedAt: new Date(),
      errorMessage: null,
    },
  });

  return data.access_token;
}

/**
 * Get a live access token, refreshing if expired or within 60-second buffer.
 */
export async function getAccessToken(
  tokenRecord: {
    id: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string | null;
    expiresAt: Date | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- WHY: union of IntegrationProvider | EmailProvider; narrowed at call sites
    provider: any;
  },
  log: ServiceLogger,
): Promise<string> {
  const isExpired = tokenRecord.expiresAt
    ? tokenRecord.expiresAt.getTime() < Date.now() + 60_000 // 1 min buffer
    : false;

  if (!isExpired) return decryptToken(tokenRecord.accessTokenEncrypted);

  if (!tokenRecord.refreshTokenEncrypted) {
    throw new Error('Token expired and no refresh token available');
  }

  const refresh = decryptToken(tokenRecord.refreshTokenEncrypted);
  if (tokenRecord.provider === 'gmail') {
    return refreshGmailToken(tokenRecord.id, refresh, log);
  }
  return refreshMsGraphToken(tokenRecord.id, refresh, log);
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
