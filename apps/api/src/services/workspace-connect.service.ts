/**
 * Workspace accounts: Google Workspace (Gmail + Calendar) and Microsoft 365
 * (Outlook + Calendar). One grant per user per provider, read-only scopes,
 * tokens encrypted at rest (token-crypto), revoked at the provider on
 * disconnect where the provider supports it.
 *
 * Google grants live on the `gmail` IntegrationToken row and Microsoft grants
 * on `microsoft_graph`, so the redirect URIs already registered with each
 * OAuth app keep working.
 */
import { z } from 'zod';
import { prisma, IntegrationProvider } from '@bidstack/db';
import {
  WORKSPACE_PROVIDERS,
  WORKSPACE_READ_SCOPES,
  describeScopes,
  type ScopeGrant,
  type WorkspaceProvider,
} from '@bidstack/shared';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';

import { fetchWithTimeout, providerTimeoutMs } from '../lib/fetch-timeout.js';
import { issueOAuthState, type OAuthStateProvider } from '../lib/oauth-state.js';
import { deleteSubscription } from './microsoft-graph-subscription.service.js';
import type { ServiceLogger } from './email-integration.helpers.js';

export const WORKSPACE_ROW: Record<WorkspaceProvider, IntegrationProvider> = {
  google: IntegrationProvider.gmail,
  microsoft: IntegrationProvider.microsoft_graph,
};

const STATE_PROVIDER: Record<WorkspaceProvider, OAuthStateProvider> = {
  google: 'gmail',
  microsoft: 'microsoft_mail',
};

/** deltaState key holding the pending OAuth nonce (read by the callbacks). */
export const NONCE_FIELD: Record<WorkspaceProvider, string> = {
  google: 'oauthNonce',
  microsoft: 'mailOAuthNonce',
};

export class WorkspaceNotConfiguredError extends Error {
  readonly statusCode = 503;
}

/** 503 body for a provider whose OAuth app is missing (the error handler masks thrown 5xx). */
export const NotConfigured = z.object({ statusCode: z.literal(503), error: z.string(), message: z.string() });

export function notConfiguredBody(err: WorkspaceNotConfiguredError): z.infer<typeof NotConfigured> {
  return { statusCode: 503, error: 'Service Unavailable', message: err.message };
}

function googleClientId(): string | undefined {
  return process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
}

/** True when the OAuth app for the provider has its client id and secret. */
export function isWorkspaceConfigured(provider: WorkspaceProvider): boolean {
  if (provider === 'google') {
    return Boolean(googleClientId() && (process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET));
  }
  return Boolean(process.env.MICROSOFT_GRAPH_CLIENT_ID && process.env.MICROSOFT_GRAPH_CLIENT_SECRET);
}

function apiBase(): string {
  return process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
}

export function googleRedirectUri(): string {
  return (
    process.env.GMAIL_REDIRECT_URI ??
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    `${apiBase()}/api/v1/integrations/gmail/oauth/callback`
  );
}

export function microsoftRedirectUri(): string {
  return process.env.MICROSOFT_GRAPH_MAIL_REDIRECT_URI ?? `${apiBase()}/api/v1/integrations/microsoft/mail/oauth/callback`;
}

export function microsoftTenant(): string {
  return process.env.MICROSOFT_TENANT_ID ?? 'common';
}

/**
 * Mint the consent URL. Stores the single-use nonce on the user's row
 * without touching an active grant: a cancelled reconnect leaves the
 * existing connection working.
 */
export async function buildConnectUrl(provider: WorkspaceProvider, orgId: string, userId: string): Promise<string> {
  if (!isWorkspaceConfigured(provider)) {
    throw new WorkspaceNotConfiguredError(
      provider === 'google' ? 'Google Workspace is not configured on this server.' : 'Microsoft 365 is not configured on this server.',
    );
  }
  const rowProvider = WORKSPACE_ROW[provider];
  const { state, nonce } = issueOAuthState(STATE_PROVIDER[provider], { orgId, userId });

  // A disconnected grant is tombstoned. The explicit deletedAt filter reaches
  // past the soft-delete middleware so the upsert below updates it instead of
  // colliding with the (org, user, provider) unique key.
  await prisma.integrationToken.updateMany({
    where: { orgId, userId, provider: rowProvider, deletedAt: { not: null } },
    data: { deletedAt: null, status: 'revoked', errorMessage: null },
  });
  const existing = await prisma.integrationToken.findFirst({
    where: { orgId, userId, provider: rowProvider },
    select: { id: true, deltaState: true },
  });
  if (existing) {
    await prisma.integrationToken.update({
      where: { id: existing.id },
      data: { deltaState: { ...((existing.deltaState ?? {}) as object), [NONCE_FIELD[provider]]: nonce } },
    });
  } else {
    await prisma.integrationToken.create({
      data: {
        orgId,
        userId,
        provider: rowProvider,
        accessTokenEncrypted: encryptToken('pending'),
        status: 'revoked',
        deltaState: { [NONCE_FIELD[provider]]: nonce },
      },
    });
  }

  const scope = WORKSPACE_READ_SCOPES[provider].join(' ');
  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: googleClientId() ?? '',
      redirect_uri: googleRedirectUri(),
      response_type: 'code',
      scope,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_GRAPH_CLIENT_ID ?? '',
    response_type: 'code',
    redirect_uri: microsoftRedirectUri(),
    scope,
    state,
    response_mode: 'query',
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/authorize?${params.toString()}`;
}

function safeDecrypt(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try {
    return decryptToken(ciphertext);
  } catch {
    return null;
  }
}

/**
 * Disconnect: revoke at the provider (best effort), drop Graph webhook
 * subscriptions, then wipe the ciphertext and tombstone the row. Idempotent.
 */
export async function disconnectWorkspace(
  provider: WorkspaceProvider,
  orgId: string,
  userId: string,
  log: ServiceLogger,
): Promise<void> {
  const row = await prisma.integrationToken.findFirst({
    where: { orgId, userId, provider: WORKSPACE_ROW[provider] },
    include: { graphSubscriptions: { select: { subscriptionId: true } } },
  });
  if (!row) return;

  const access = row.status === 'active' ? safeDecrypt(row.accessTokenEncrypted) : null;
  const refresh = safeDecrypt(row.refreshTokenEncrypted);
  try {
    if (provider === 'google' && (refresh ?? access)) {
      // Revoking the refresh token also invalidates its access tokens.
      const res = await fetchWithTimeout('https://oauth2.googleapis.com/revoke', {
        provider: 'Google',
        operation: 'oauth.revoke',
        timeoutMs: providerTimeoutMs('OAUTH_HTTP_TIMEOUT_MS', 15_000),
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: (refresh ?? access) as string }).toString(),
      });
      if (!res.ok && res.status !== 400) log.warn({ status: res.status }, 'Google revoke returned an error');
    }
    if (provider === 'microsoft' && access) {
      // Microsoft has no per-app delegated revoke endpoint; removing the
      // webhook subscriptions and the stored tokens ends Polo's access.
      await Promise.all(row.graphSubscriptions.map((s) => deleteSubscription(s.subscriptionId, access, log)));
    }
  } catch (err) {
    log.warn({ err, provider }, 'Provider-side revoke failed; disconnecting locally anyway');
  }

  await prisma.graphSubscription.deleteMany({ where: { integrationTokenId: row.id } });
  await prisma.integrationToken.update({
    where: { id: row.id },
    data: {
      accessTokenEncrypted: encryptToken('revoked'),
      refreshTokenEncrypted: null,
      scope: [],
      expiresAt: null,
      deltaState: {},
      status: 'revoked',
      errorMessage: null,
      deletedAt: new Date(),
    },
  });
}

/** Status of one provider card. */
export interface WorkspaceCard {
  provider: WorkspaceProvider;
  configured: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'revoked';
  accountEmail: string | null;
  scopes: ScopeGrant[];
  lastSyncedAt: string | null;
  connectedAt: string | null;
  errorMessage: string | null;
}

/** One card per provider for the signed-in user. Never reads ciphertext. */
export async function listWorkspaceCards(orgId: string, userId: string): Promise<WorkspaceCard[]> {
  const rows = await prisma.integrationToken.findMany({
    where: { orgId, userId, provider: { in: Object.values(WORKSPACE_ROW) } },
    take: 10,
    select: {
      provider: true,
      status: true,
      scope: true,
      externalAccountEmail: true,
      lastSyncedAt: true,
      lastRefreshedAt: true,
      errorMessage: true,
    },
  });
  return WORKSPACE_PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === WORKSPACE_ROW[provider]);
    // A revoked row with scopes was once connected; a pending first connect
    // or a wiped disconnect has none and reads as disconnected.
    const status: WorkspaceCard['status'] = !row
      ? 'disconnected'
      : row.status === 'active'
        ? 'connected'
        : row.status === 'error'
          ? 'error'
          : row.errorMessage || row.scope.length > 0
            ? 'revoked'
            : 'disconnected';
    const live = status !== 'disconnected';
    return {
      provider,
      configured: isWorkspaceConfigured(provider),
      status,
      accountEmail: live ? (row?.externalAccountEmail ?? null) : null,
      scopes: live ? describeScopes(row?.scope ?? []) : [],
      lastSyncedAt: live ? (row?.lastSyncedAt?.toISOString() ?? null) : null,
      connectedAt: live ? (row?.lastRefreshedAt?.toISOString() ?? null) : null,
      errorMessage: live ? (row?.errorMessage ?? null) : null,
    };
  });
}
