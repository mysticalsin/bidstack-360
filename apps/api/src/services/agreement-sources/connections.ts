// Per-org provider connections for the agreement pull (slice 13a review).
//
// The deployment env names the OAuth apps only (MICROSOFT_GRAPH_CLIENT_ID /
// MICROSOFT_GRAPH_CLIENT_SECRET, DOCUSIGN_INTEGRATION_KEY /
// DOCUSIGN_CLIENT_SECRET). Data access always runs as the org's own grant:
//  - SharePoint: the Entra tenant whose admin consented; tokens are minted
//    for that tenant and every drive must belong to it.
//  - DocuSign: the account the consenting user belongs to; a refresh token
//    (encrypted with INTEGRATION_TOKEN_KEY) and a userinfo check each run.
// A source may only use a connection of its own org. Env data-access
// credentials (MICROSOFT_TENANT_ID, DOCUSIGN_USER_ID + DOCUSIGN_PRIVATE_KEY)
// are used only when AGREEMENT_SOURCES_SINGLE_TENANT=true.
import { prisma, type Prisma } from '@bidstack/db';
import { DocuSignSourceConfig, SharePointSourceConfig, type AgreementConnection, type AgreementSourceKind } from '@bidstack/shared';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';

import { issueOAuthState, OAuthStateError, openOAuthState } from '../../lib/oauth-state.js';
import {
  docuSignAppFromEnv,
  docuSignConsentUrl,
  docuSignCredentialsFromEnv,
  exchangeDocuSignCode,
  getDocuSignAccounts,
  getDocuSignToken,
  refreshDocuSignToken,
} from './docusign-envelopes.js';
import { getGraphAppToken, graphCredentialsFromEnv, verifyDriveTenant, type FetchFn } from './graph-drive.js';

export type ConnectionErrorCode = 'not_found' | 'not_connected' | 'not_configured' | 'ownership';

export class ConnectionError extends Error {
  constructor(
    readonly code: ConnectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConnectionError';
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let fetchOverride: FetchFn | null = null;

/** Routes reach providers through this; tests swap in a recorded fetch. */
export function __setAgreementConnectionFetchForTest(fn: FetchFn | null): void {
  fetchOverride = fn;
}

export function connectionFetch(): FetchFn {
  return fetchOverride ?? fetch;
}

export function isSingleTenantDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGREEMENT_SOURCES_SINGLE_TENANT?.trim().toLowerCase() === 'true';
}

function graphApp(env: NodeJS.ProcessEnv): { clientId: string; clientSecret: string } | null {
  const clientId = env.MICROSOFT_GRAPH_CLIENT_ID?.trim();
  const clientSecret = env.MICROSOFT_GRAPH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function connectionRedirectUri(provider: AgreementSourceKind, env: NodeJS.ProcessEnv = process.env): string {
  return `${env.PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/integrations/agreements/${provider}/callback`;
}

const CONNECTION_SELECT = {
  id: true,
  orgId: true,
  provider: true,
  status: true,
  externalTenantId: true,
  accountId: true,
  accountName: true,
  baseUri: true,
  secretEncrypted: true,
  connectedAt: true,
} as const;

type ConnectionRow = Prisma.AgreementConnectionGetPayload<{ select: typeof CONNECTION_SELECT }>;

export function serializeConnection(row: ConnectionRow): AgreementConnection {
  return {
    id: row.id,
    provider: row.provider as AgreementSourceKind,
    status: row.status as AgreementConnection['status'],
    externalTenantId: row.externalTenantId,
    accountId: row.accountId,
    accountName: row.accountName,
    connectedAt: row.connectedAt?.toISOString() ?? null,
  };
}

export async function listOrgConnections(orgId: string): Promise<ConnectionRow[]> {
  return prisma.agreementConnection.findMany({ where: { orgId }, orderBy: { provider: 'asc' }, take: 10, select: CONNECTION_SELECT });
}

/** The org's connection for a provider; another org's id is never found. */
export async function findOrgConnection(orgId: string, provider: AgreementSourceKind, connectionId?: string | null): Promise<ConnectionRow | null> {
  return prisma.agreementConnection.findFirst({
    where: { orgId, provider, ...(connectionId ? { id: connectionId } : {}) },
    select: CONNECTION_SELECT,
  });
}

/** True when a source of this kind can run for the org right now. */
export async function connectionReady(orgId: string, kind: AgreementSourceKind, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const conn = await prisma.agreementConnection.findFirst({ where: { orgId, provider: kind, status: 'connected' }, select: { id: true } });
  if (conn) return kind === 'sharepoint' ? graphApp(env) !== null : docuSignAppFromEnv(env) !== null;
  if (!isSingleTenantDeployment(env)) return false;
  return kind === 'sharepoint' ? graphCredentialsFromEnv(env) !== null : docuSignCredentialsFromEnv(env) !== null;
}

export type SourceAccess =
  | { kind: 'sharepoint'; token: string; tenantId: string }
  | { kind: 'docusign'; token: string; accountId: string; baseUrl: string };

type SourceRef = { orgId: string; kind: string; connectionId: string | null; config: Prisma.JsonValue };

async function sharePointAccess(source: SourceRef, conn: ConnectionRow | null, fetchFn: FetchFn, env: NodeJS.ProcessEnv): Promise<SourceAccess> {
  const config = SharePointSourceConfig.parse(source.config);
  let creds: { tenantId: string; clientId: string; clientSecret: string } | null;
  if (conn) {
    const app = graphApp(env);
    if (!app) throw new ConnectionError('not_configured', 'The Microsoft Graph app is not configured');
    if (!conn.externalTenantId) throw new ConnectionError('not_connected', 'SharePoint is not connected');
    creds = { tenantId: conn.externalTenantId, ...app };
  } else {
    creds = graphCredentialsFromEnv(env);
    if (!creds) throw new ConnectionError('not_configured', 'Microsoft Graph app credentials are not configured');
  }
  const token = await getGraphAppToken(fetchFn, creds);
  try {
    await verifyDriveTenant(fetchFn, token, config.driveId, creds.tenantId);
  } catch (err) {
    if (err instanceof Error && 'status' in err && (err as { status: number | null }).status === 403) {
      throw new ConnectionError('ownership', err.message);
    }
    throw err;
  }
  return { kind: 'sharepoint', token, tenantId: creds.tenantId };
}

async function docuSignAccess(conn: ConnectionRow | null, fetchFn: FetchFn, env: NodeJS.ProcessEnv): Promise<SourceAccess> {
  if (!conn) {
    const creds = docuSignCredentialsFromEnv(env);
    if (!creds) throw new ConnectionError('not_configured', 'DocuSign credentials are not configured');
    return { kind: 'docusign', token: await getDocuSignToken(fetchFn, creds), accountId: creds.accountId, baseUrl: creds.baseUrl };
  }
  const app = docuSignAppFromEnv(env);
  if (!app) throw new ConnectionError('not_configured', 'The DocuSign app is not configured');
  if (!conn.secretEncrypted || !conn.accountId) throw new ConnectionError('not_connected', 'DocuSign is not connected');
  const tokens = await refreshDocuSignToken(fetchFn, app, decryptToken(conn.secretEncrypted));
  await prisma.agreementConnection.updateMany({
    where: { id: conn.id, orgId: conn.orgId },
    data: { secretEncrypted: encryptToken(tokens.refreshToken) },
  });
  const accounts = await getDocuSignAccounts(fetchFn, app.oauthHost, tokens.accessToken);
  const account = accounts.find((a) => a.accountId === conn.accountId);
  if (!account) throw new ConnectionError('ownership', 'The DocuSign account no longer belongs to this connection');
  return { kind: 'docusign', token: tokens.accessToken, accountId: account.accountId, baseUrl: account.baseUri };
}

/**
 * Credentials for one source run. The connection must belong to the source's
 * org, be connected, and own the drive or account; otherwise this throws.
 */
export async function resolveSourceAccess(
  source: SourceRef,
  deps: { fetch?: FetchFn; env?: NodeJS.ProcessEnv } = {},
): Promise<SourceAccess> {
  const fetchFn = deps.fetch ?? connectionFetch();
  const env = deps.env ?? process.env;
  const kind = source.kind as AgreementSourceKind;
  let conn: ConnectionRow | null = null;
  if (source.connectionId) {
    conn = await findOrgConnection(source.orgId, kind, source.connectionId);
    if (!conn) throw new ConnectionError('not_found', 'The connection does not belong to this organization');
    if (conn.status !== 'connected') throw new ConnectionError('not_connected', 'The connection is not active; connect it again');
  } else if (!isSingleTenantDeployment(env)) {
    throw new ConnectionError('not_connected', `Connect ${kind === 'sharepoint' ? 'SharePoint' : 'DocuSign'} for this organization first`);
  }
  if (kind === 'docusign') {
    DocuSignSourceConfig.parse(source.config);
    return docuSignAccess(conn, fetchFn, env);
  }
  return sharePointAccess(source, conn, fetchFn, env);
}

/** Begin an admin consent (Graph) or account OAuth (DocuSign) for the caller's org. */
export async function startConnection(
  provider: AgreementSourceKind,
  who: { orgId: string; userId: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ url: string; connectionId: string }> {
  const graph = graphApp(env);
  const docusign = docuSignAppFromEnv(env);
  if (provider === 'sharepoint' && !graph) throw new ConnectionError('not_configured', 'The Microsoft Graph app is not configured');
  if (provider === 'docusign' && !docusign) throw new ConnectionError('not_configured', 'The DocuSign app is not configured');
  const { state, nonce } = issueOAuthState(provider === 'sharepoint' ? 'agreement_sharepoint' : 'agreement_docusign', who);
  const row = await prisma.agreementConnection.upsert({
    where: { orgId_provider: { orgId: who.orgId, provider } },
    create: { orgId: who.orgId, provider, createdById: who.userId, stateNonce: nonce },
    update: { stateNonce: nonce },
    select: { id: true },
  });
  const redirectUri = connectionRedirectUri(provider, env);
  if (provider === 'docusign') return { url: docuSignConsentUrl(docusign!, redirectUri, state), connectionId: row.id };
  const params = new URLSearchParams({
    client_id: graph!.clientId,
    scope: 'https://graph.microsoft.com/.default',
    redirect_uri: redirectUri,
    state,
  });
  return { url: `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${params.toString()}`, connectionId: row.id };
}

/** Open the sealed state and consume its nonce once (compare-and-swap on the row). */
async function consumeConnectionState(provider: AgreementSourceKind, state: string): Promise<{ orgId: string; userId: string; id: string }> {
  const opened = openOAuthState(provider === 'sharepoint' ? 'agreement_sharepoint' : 'agreement_docusign', state);
  const user = await prisma.user.findFirst({ where: { id: opened.userId, orgId: opened.orgId, deletedAt: null }, select: { id: true } });
  if (!user) throw new OAuthStateError('invalid');
  const row = await prisma.agreementConnection.findFirst({
    where: { orgId: opened.orgId, provider, stateNonce: opened.nonce },
    select: { id: true },
  });
  if (!row) throw new OAuthStateError('replayed');
  const swapped = await prisma.agreementConnection.updateMany({
    where: { id: row.id, stateNonce: opened.nonce },
    data: { stateNonce: null },
  });
  if (swapped.count !== 1) throw new OAuthStateError('replayed');
  return { orgId: opened.orgId, userId: opened.userId, id: row.id };
}

async function auditConnection(orgId: string, userId: string, id: string, action: string, diff: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: { orgId, userId, action, targetType: 'agreement_connection', targetId: id, diff: diff as Prisma.InputJsonValue },
  });
}

/** Graph admin consent callback: record the consenting tenant after a token works for it. */
export async function completeSharePointConsent(
  q: { state: string; tenant?: string; adminConsent?: string },
  deps: { fetch?: FetchFn; env?: NodeJS.ProcessEnv } = {},
): Promise<{ orgId: string }> {
  const env = deps.env ?? process.env;
  const who = await consumeConnectionState('sharepoint', q.state);
  const app = graphApp(env);
  if (!app) throw new ConnectionError('not_configured', 'The Microsoft Graph app is not configured');
  if (!q.tenant || !GUID.test(q.tenant) || String(q.adminConsent).toLowerCase() !== 'true') {
    throw new ConnectionError('not_connected', 'Admin consent was not granted');
  }
  await getGraphAppToken(deps.fetch ?? connectionFetch(), { tenantId: q.tenant, ...app });
  await prisma.agreementConnection.updateMany({
    where: { id: who.id, orgId: who.orgId },
    data: { status: 'connected', externalTenantId: q.tenant.toLowerCase(), connectedById: who.userId, connectedAt: new Date(), revokedAt: null },
  });
  await auditConnection(who.orgId, who.userId, who.id, 'agreement.connection.connected', { provider: 'sharepoint', tenantId: q.tenant.toLowerCase() });
  return { orgId: who.orgId };
}

/** DocuSign OAuth callback: store the refresh token and the user's default account. */
export async function completeDocuSignConsent(
  q: { state: string; code: string },
  deps: { fetch?: FetchFn; env?: NodeJS.ProcessEnv } = {},
): Promise<{ orgId: string }> {
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetch ?? connectionFetch();
  const who = await consumeConnectionState('docusign', q.state);
  const app = docuSignAppFromEnv(env);
  if (!app) throw new ConnectionError('not_configured', 'The DocuSign app is not configured');
  const tokens = await exchangeDocuSignCode(fetchFn, app, q.code, connectionRedirectUri('docusign', env));
  const accounts = await getDocuSignAccounts(fetchFn, app.oauthHost, tokens.accessToken);
  const account = accounts.find((a) => a.isDefault) ?? accounts[0];
  if (!account) throw new ConnectionError('not_connected', 'The DocuSign user has no account');
  await prisma.agreementConnection.updateMany({
    where: { id: who.id, orgId: who.orgId },
    data: {
      status: 'connected',
      accountId: account.accountId,
      accountName: account.accountName?.slice(0, 200) ?? null,
      baseUri: account.baseUri,
      secretEncrypted: encryptToken(tokens.refreshToken),
      connectedById: who.userId,
      connectedAt: new Date(),
      revokedAt: null,
    },
  });
  await auditConnection(who.orgId, who.userId, who.id, 'agreement.connection.connected', { provider: 'docusign', accountId: account.accountId });
  return { orgId: who.orgId };
}

export async function revokeConnection(orgId: string, userId: string, id: string): Promise<boolean> {
  const res = await prisma.agreementConnection.updateMany({
    where: { id, orgId },
    data: { status: 'revoked', secretEncrypted: null, stateNonce: null, revokedAt: new Date() },
  });
  if (res.count === 1) await auditConnection(orgId, userId, id, 'agreement.connection.revoked', {});
  return res.count === 1;
}
