/**
 * email-sync.helpers.ts — schemas, error types, and MS Graph token utilities.
 *
 * Extracted from email-sync.ts (BS-R1 file-size refactor).
 * Used by email-sync.pull.ts, email-sync.subscriptions.ts, and email-sync.ts.
 */
import type pino from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';

// ─── Job data schema ─────────────────────────────────────────────────────────

export const PullJobData = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  integrationTokenId: z.string().uuid(),
});

// ─── Typed error for rate-limit signalling ────────────────────────────────────

export class RateLimitError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`Graph 429 — retry after ${retryAfterMs}ms`);
    this.retryAfterMs = retryAfterMs;
  }
}

// ─── Token helpers ────────────────────────────────────────────────────────────

function tenant(): string {
  return process.env.MICROSOFT_TENANT_ID ?? 'common';
}
function graphClientId(): string {
  return process.env.MICROSOFT_GRAPH_CLIENT_ID ?? '';
}
function graphClientSecret(): string {
  return process.env.MICROSOFT_GRAPH_CLIENT_SECRET ?? '';
}

export async function refreshMsGraphToken(
  tokenId: string,
  refreshToken: string,
  log: pino.Logger,
): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: graphClientId(),
      client_secret: graphClientSecret(),
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
      ...(data.refresh_token ? { refreshTokenEncrypted: encryptToken(data.refresh_token) } : {}),
      expiresAt,
      status: 'active',
      lastRefreshedAt: new Date(),
      errorMessage: null,
    },
  });

  return data.access_token;
}

export async function getAccessToken(
  row: {
    id: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string | null;
    expiresAt: Date | null;
  },
  log: pino.Logger,
): Promise<string> {
  const isExpired = row.expiresAt ? row.expiresAt.getTime() < Date.now() + 60_000 : false;

  if (!isExpired) return decryptToken(row.accessTokenEncrypted);
  if (!row.refreshTokenEncrypted) throw new Error('Token expired — no refresh token');

  return refreshMsGraphToken(row.id, decryptToken(row.refreshTokenEncrypted), log);
}
