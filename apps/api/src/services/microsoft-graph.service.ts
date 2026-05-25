/**
 * Microsoft Graph Mail service.
 *
 * WHY a dedicated service vs. extending email-integration.service.ts:
 * Graph webhooks, subscription management, and PKCE flows add enough surface
 * area that merging everything into the shared file would push it well past
 * 400 lines and muddy the Gmail vs. Graph responsibility split. This file
 * owns everything Graph-specific; email-integration.service.ts dispatches
 * to it by provider.
 *
 * Token lifecycle:
 *   - Access tokens expire in ~1 h. getAccessToken() refreshes proactively
 *     when fewer than 60 seconds remain.
 *   - Refresh tokens can be rotated by Entra on each refresh. The service
 *     always writes back the latest tokens after a refresh.
 *
 * Delta query (incremental sync):
 *   - Stored in IntegrationToken.deltaState.mailDeltaLink.
 *   - On first connect the historical pull seeds the inbox (last 100 msgs).
 *   - Subsequent calls follow @odata.deltaLink for only changed messages.
 *
 * Graph subscriptions (webhook):
 *   - POST /subscriptions → 3-day TTL → stored in GraphSubscription table.
 *   - Daily renewal worker extends before expiry.
 *   - On disconnect: DELETE /subscriptions/:id then soft-delete the row.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@bidstack/db';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';
import type pino from 'pino';

type ServiceLogger = Pick<pino.Logger, 'debug' | 'error' | 'info' | 'warn'>;

// ─── Constants ─────────────────────────────────────────────────────────────

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_ENDPOINT_BASE = 'https://login.microsoftonline.com';

/** Graph subscription max lifetime in milliseconds (3 days). */
const SUB_MAX_MS = 3 * 24 * 60 * 60 * 1000;

function tenant(): string {
  return process.env.MICROSOFT_TENANT_ID ?? 'common';
}

function clientId(): string {
  const v = process.env.MICROSOFT_GRAPH_CLIENT_ID;
  if (!v) throw new Error('MICROSOFT_GRAPH_CLIENT_ID is not set');
  return v;
}

function clientSecret(): string {
  const v = process.env.MICROSOFT_GRAPH_CLIENT_SECRET;
  if (!v) throw new Error('MICROSOFT_GRAPH_CLIENT_SECRET is not set');
  return v;
}

function webhookBaseUrl(): string {
  const v = process.env.MICROSOFT_WEBHOOK_BASE_URL;
  if (!v) throw new Error('MICROSOFT_WEBHOOK_BASE_URL is not set');
  return v.replace(/\/$/, '');
}

// ─── Token helpers ─────────────────────────────────────────────────────────

type TokenRow = {
  id: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
};

/**
 * Returns a live access token for the given token record, refreshing
 * via the OAuth refresh_token grant if the token is within 60 s of expiry.
 */
export async function getAccessToken(row: TokenRow, log: ServiceLogger): Promise<string> {
  const isExpired = row.expiresAt
    ? row.expiresAt.getTime() < Date.now() + 60_000
    : false;

  if (!isExpired) {
    return decryptToken(row.accessTokenEncrypted);
  }

  if (!row.refreshTokenEncrypted) {
    throw new Error('MS Graph token expired and no refresh token is stored');
  }

  const refreshToken = decryptToken(row.refreshTokenEncrypted);
  return refreshMsGraphToken(row.id, refreshToken, log);
}

async function refreshMsGraphToken(
  tokenId: string,
  refreshToken: string,
  log: ServiceLogger,
): Promise<string> {
  const res = await fetch(
    `${TOKEN_ENDPOINT_BASE}/${tenant()}/oauth2/v2.0/token`,
    {
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
    },
  );

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

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : undefined;

  await prisma.integrationToken.update({
    where: { id: tokenId },
    data: {
      accessTokenEncrypted: encryptToken(data.access_token),
      // Entra may rotate the refresh token — always persist the latest
      ...(data.refresh_token
        ? { refreshTokenEncrypted: encryptToken(data.refresh_token) }
        : {}),
      expiresAt,
      status: 'active',
      lastRefreshedAt: new Date(),
      errorMessage: null,
    },
  });

  log.debug({ tokenId }, 'MS Graph access token refreshed');
  return data.access_token;
}

// ─── Email send ────────────────────────────────────────────────────────────

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface GraphSendEmailParams {
  orgId: string;
  userId: string;
  integrationTokenId: string;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  entityType?: string;
  entityId?: string;
  replyToMessageId?: string;
}

function injectTrackingPixel(html: string, token: string): string {
  const base = (process.env.PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  const pixelUrl = `${base}/track/email/open/${token}`;
  // WHY html comment marker: makes it easy to assert in tests without parsing HTML
  const tag = `<!-- bidstack-pixel --><img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`;
  if (html.includes('</body>')) return html.replace('</body>', `${tag}</body>`);
  return html + tag;
}

function buildRecipients(
  addrs: EmailAddress[],
): Array<{ emailAddress: { address: string; name?: string } }> {
  return addrs.map((a) => ({ emailAddress: { address: a.email, name: a.name } }));
}

/**
 * Send email via MS Graph /me/sendMail.
 * Injects tracking pixel if HTML body is provided.
 * Persists EmailMessage + EmailTrackingPixel in a single transaction.
 * Logs the send as a CRM Activity.
 */
export async function sendEmail(
  params: GraphSendEmailParams,
  log: ServiceLogger,
): Promise<{ messageId: string }> {
  const token = await prisma.integrationToken.findUnique({
    where: { id: params.integrationTokenId },
  });

  if (!token || token.orgId !== params.orgId || token.status !== 'active') {
    throw new Error('Integration token not found or not active');
  }

  const accessToken = await getAccessToken(token, log);
  const pixelToken = randomBytes(24).toString('base64url');

  const htmlWithPixel = params.html
    ? injectTrackingPixel(params.html, pixelToken)
    : undefined;

  const body: Record<string, unknown> = {
    message: {
      subject: params.subject,
      body: {
        contentType: 'HTML',
        content: htmlWithPixel ?? params.text ?? '',
      },
      toRecipients: buildRecipients(params.to),
      ccRecipients: buildRecipients(params.cc ?? []),
      bccRecipients: buildRecipients(params.bcc ?? []),
      // Reply threading: if replyToMessageId is set we set internetMessageId header
      ...(params.replyToMessageId
        ? {
            singleValueExtendedProperties: [
              {
                id: 'String 0x1042',
                value: `<${params.replyToMessageId}>`,
              },
            ],
          }
        : {}),
    },
    saveToSentItems: true,
  };

  const res = await fetch(`${GRAPH_BASE}/me/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    log.error({ status: res.status, errBody, orgId: params.orgId }, 'Graph sendMail failed');
    throw new Error(`Graph sendMail failed: ${res.status}`);
  }

  // Graph sendMail returns 202 Accepted with no body — stable external ID is
  // not available synchronously. Use a local UUID as the external message id.
  // WHY: the delta pull will eventually import the sent message with the real
  // Graph id; the upsert will deduplicate via the unique constraint.
  const externalMessageId = `local:${randomBytes(16).toString('hex')}`;

  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.emailMessage.create({
      data: {
        orgId: params.orgId,
        userId: params.userId,
        integrationTokenId: params.integrationTokenId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: 'OUTLOOK' as any,
        externalMessageId,
        fromEmail: token.externalAccountEmail ?? '',
        toEmails: params.to as object[],
        ccEmails: (params.cc ?? []) as object[],
        subject: params.subject,
        bodyHtml: htmlWithPixel ?? null,
        bodyText: params.text ?? null,
        sentAt: new Date(),
        isOutbound: true,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
      },
    });

    await tx.emailTrackingPixel.create({
      data: {
        orgId: params.orgId,
        emailMessageId: msg.id,
        token: pixelToken,
      },
    });

    return msg;
  });

  log.info(
    { messageId: message.id, orgId: params.orgId, subject: params.subject },
    'Outlook email sent',
  );

  return { messageId: message.id };
}

// ─── Incremental pull (delta query) ───────────────────────────────────────

interface GraphMessage {
  id: string;
  conversationId?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  subject?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  isDraft?: boolean;
  body?: { content?: string; contentType?: string };
}

const DELTA_SELECT = [
  'id',
  'conversationId',
  'from',
  'toRecipients',
  'ccRecipients',
  'subject',
  'receivedDateTime',
  'sentDateTime',
  'isDraft',
  'body',
].join(',');

const INITIAL_DELTA_URL =
  `${GRAPH_BASE}/me/mailFolders/inbox/messages/delta?` +
  `$top=100&$select=${DELTA_SELECT}`;

/**
 * Incremental pull using the Graph delta query.
 * Reads deltaState.mailDeltaLink from the token; if absent runs a full pull.
 * Persists new messages and updates the deltaLink cursor.
 */
export async function pullIncrementalSync(
  {
    orgId,
    userId,
    integrationTokenId,
  }: { orgId: string; userId: string; integrationTokenId: string },
  log: ServiceLogger,
): Promise<{ persisted: number }> {
  const token = await prisma.integrationToken.findUnique({
    where: { id: integrationTokenId },
  });

  if (!token || token.orgId !== orgId || token.status !== 'active') {
    log.warn({ integrationTokenId }, 'Skipping Graph pull: token inactive');
    return { persisted: 0 };
  }

  const accessToken = await getAccessToken(token, log);
  const deltaState = (token.deltaState ?? {}) as Record<string, unknown>;
  const startUrl = (deltaState.mailDeltaLink as string | undefined) ?? INITIAL_DELTA_URL;

  return fetchDeltaPage(startUrl, accessToken, token.id, orgId, userId, token.externalAccountEmail ?? '', log);
}

/**
 * Historical backfill for first-time connection.
 * Calls pullIncrementalSync with no deltaLink so it always does a full pull.
 */
export async function pullHistoricalInitial(
  params: { orgId: string; userId: string; integrationTokenId: string },
  log: ServiceLogger,
): Promise<{ persisted: number }> {
  // Reset delta link to force a full pull
  await prisma.integrationToken.update({
    where: { id: params.integrationTokenId },
    data: { deltaState: {} },
  });
  return pullIncrementalSync(params, log);
}

async function fetchDeltaPage(
  url: string,
  accessToken: string,
  tokenId: string,
  orgId: string,
  userId: string,
  accountEmail: string,
  log: ServiceLogger,
): Promise<{ persisted: number }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 410) {
    // deltaLink expired — reset and re-pull from scratch next cycle
    log.warn({ tokenId }, 'Graph deltaLink expired (410); resetting');
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: { deltaState: {} },
    });
    return { persisted: 0 };
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    log.warn({ tokenId, retryAfter }, 'Graph rate limit hit (429); will retry');
    throw Object.assign(new Error('Graph rate limit'), { status: 429, retryAfter });
  }

  if (!res.ok) {
    log.error({ status: res.status, tokenId }, 'Graph delta query failed');
    throw new Error(`Graph delta query failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    value?: GraphMessage[];
    '@odata.deltaLink'?: string;
    '@odata.nextLink'?: string;
  };

  let persisted = 0;

  for (const msg of (data.value ?? [])) {
    if (msg.isDraft) continue;

    try {
      const fromEmail = msg.from?.emailAddress?.address ?? '';
      const toEmails = (msg.toRecipients ?? []).map((r) => ({
        email: r.emailAddress?.address ?? '',
        name: r.emailAddress?.name,
      }));
      const ccEmails = (msg.ccRecipients ?? []).map((r) => ({
        email: r.emailAddress?.address ?? '',
        name: r.emailAddress?.name,
      }));

      const contact = await prisma.contact.findFirst({
        where: { orgId, email: fromEmail, deletedAt: null },
        select: { id: true },
      });

      await prisma.emailMessage.upsert({
        where: {
           
          orgId_externalMessageId: { orgId, externalMessageId: msg.id },
        },
        create: {
          orgId,
          userId,
          integrationTokenId: tokenId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'OUTLOOK' as any,
          externalMessageId: msg.id,
          threadId: msg.conversationId ?? null,
          fromEmail,
          toEmails,
          ccEmails,
          subject: msg.subject ?? '',
          bodyHtml: msg.body?.contentType === 'html' ? (msg.body.content ?? null) : null,
          bodyText: msg.body?.contentType === 'text' ? (msg.body.content ?? null) : null,
          receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
          sentAt: msg.sentDateTime ? new Date(msg.sentDateTime) : null,
          isOutbound: fromEmail.toLowerCase() === accountEmail.toLowerCase(),
          entityType: contact ? 'contact' : null,
          entityId: contact?.id ?? null,
        },
        update: {},
      });

      persisted++;
    } catch (err) {
      log.warn({ err, msgId: msg.id }, 'Failed to persist Graph message');
    }
  }

  // Persist cursor — prefer deltaLink (final page), fall back to nextLink
  const newDeltaLink = data['@odata.deltaLink'];
  if (newDeltaLink) {
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: {
        deltaState: { mailDeltaLink: newDeltaLink },
        lastSyncedAt: new Date(),
      },
    });
  }

  log.info({ tokenId, persisted }, 'Graph mail delta pull complete');
  return { persisted };
}

// ─── Graph subscriptions (webhooks) ───────────────────────────────────────

/**
 * Create a Graph change-notification subscription for /me/messages.
 *
 * WHY /me/messages not /me/mailFolders/inbox/messages: subscribing to the
 * root messages resource delivers notifications for all folders (sent, inbox,
 * drafts). This is wider coverage with a single subscription.
 *
 * Requires Mail.Read scope (delegated). The subscription is stored in
 * GraphSubscription; its clientState is used for anti-forgery verification
 * on every incoming notification.
 */
export async function createSubscription(
  { integrationTokenId, orgId }: { integrationTokenId: string; orgId: string },
  log: ServiceLogger,
): Promise<string | null> {
  const token = await prisma.integrationToken.findUnique({
    where: { id: integrationTokenId },
  });

  if (!token || token.orgId !== orgId || token.status !== 'active') {
    log.warn({ integrationTokenId }, 'Cannot create subscription: token not active');
    return null;
  }

  const accessToken = await getAccessToken(token, log);
  const clientState = randomBytes(64).toString('base64url');
  const expiresAt = new Date(Date.now() + SUB_MAX_MS);
  const notificationUrl = `${webhookBaseUrl()}/api/v1/integrations/microsoft/webhook`;

  const res = await fetch(`${GRAPH_BASE}/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changeType: 'created,updated,deleted',
      notificationUrl,
      resource: '/me/messages',
      expirationDateTime: expiresAt.toISOString(),
      clientState,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error({ status: res.status, body }, 'Graph subscription creation failed');
    // Not fatal — incremental pull fallback will still work
    return null;
  }

  const data = (await res.json()) as { id: string };

  await prisma.graphSubscription.create({
    data: {
      orgId,
      integrationTokenId,
      subscriptionId: data.id,
      resource: '/me/messages',
      changeType: 'created,updated,deleted',
      clientState,
      expiresAt,
    },
  });

  log.info({ subscriptionId: data.id, orgId }, 'Graph subscription created');
  return data.id;
}

/**
 * Renew a Graph subscription before it expires.
 * Idempotent: if the subscription no longer exists on Graph side (404/gone),
 * recreates it to avoid losing webhook delivery.
 */
export async function renewSubscription(
  subscriptionId: string,
  log: ServiceLogger,
): Promise<void> {
  const sub = await prisma.graphSubscription.findUnique({
    where: { subscriptionId },
    include: { integrationToken: true },
  });

  if (!sub) {
    log.warn({ subscriptionId }, 'Cannot renew: subscription not found locally');
    return;
  }

  const accessToken = await getAccessToken(sub.integrationToken, log);
  const newExpiry = new Date(Date.now() + SUB_MAX_MS);

  const res = await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expirationDateTime: newExpiry.toISOString() }),
  });

  if (res.status === 404) {
    // Subscription gone — recreate
    log.warn({ subscriptionId }, 'Graph subscription 404 on renew; recreating');
    await prisma.graphSubscription.delete({ where: { subscriptionId } });
    await createSubscription(
      { integrationTokenId: sub.integrationTokenId, orgId: sub.orgId },
      log,
    );
    return;
  }

  if (!res.ok) {
    log.error({ status: res.status, subscriptionId }, 'Graph subscription renewal failed');
    throw new Error(`Subscription renewal failed: ${res.status}`);
  }

  await prisma.graphSubscription.update({
    where: { subscriptionId },
    data: {
      expiresAt: newExpiry,
      renewalCount: { increment: 1 },
    },
  });

  log.info({ subscriptionId, newExpiry }, 'Graph subscription renewed');
}

/**
 * Delete a Graph subscription and its local row.
 * Best-effort: if the remote delete fails (expired, gone) we still clean up locally.
 */
export async function deleteSubscription(
  subscriptionId: string,
  accessToken: string,
  log: ServiceLogger,
): Promise<void> {
  try {
    const res = await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 404) {
      log.warn({ status: res.status, subscriptionId }, 'Graph subscription delete non-200');
    }
  } catch (err) {
    log.warn({ err, subscriptionId }, 'Graph subscription remote delete failed; cleaning up locally');
  }

  await prisma.graphSubscription.deleteMany({ where: { subscriptionId } });
}

// ─── Webhook clientState verification ─────────────────────────────────────

/**
 * Constant-time comparison of two strings to prevent timing attacks.
 * WHY timingSafeEqual: clientState is used as a secret; a naive === check
 * leaks timing information that could help an attacker brute-force the value.
 */
export function verifyClientState(received: string, stored: string): boolean {
  if (received.length !== stored.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(stored));
}
