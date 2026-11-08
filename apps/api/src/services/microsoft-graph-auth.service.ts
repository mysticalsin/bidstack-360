// Microsoft Graph token lifecycle.
//
// Responsibilities:
//   - Environment config accessors (clientId, clientSecret, tenant, webhookBaseUrl)
//   - Access token expiry check and proactive refresh via refresh_token grant
//
// Imported by microsoft-graph.service.ts (email + delta) and
// microsoft-graph-subscription.service.ts (subscriptions).

import { getAccessToken as getIntegrationAccessToken } from './email-integration.helpers.js';
import type { ServiceLogger } from './email-integration.helpers.js';

export type { ServiceLogger };

// ─── Constants ────────────────────────────────────────────────────────────────

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

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
  orgId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
  scope?: string[];
};

/**
 * Returns a live access token for the given token record, refreshing
 * via the OAuth refresh_token grant if the token is within 60 s of expiry.
 * Refresh, rotation and revocation handling live in email-integration.helpers.
 */
export async function getAccessToken(row: TokenRow, log: ServiceLogger): Promise<string> {
  return getIntegrationAccessToken({ ...row, provider: 'microsoft_graph' }, log);
}
