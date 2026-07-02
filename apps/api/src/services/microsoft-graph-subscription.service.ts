// Microsoft Graph subscription management + webhook verification.
//
// Responsibilities:
//   - Create, renew, and delete Graph change-notification subscriptions
//   - Constant-time clientState verification for incoming webhook notifications
//
// Token lifecycle → microsoft-graph-auth.service.ts
// Email send + delta sync → microsoft-graph.service.ts

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '@bidstack/db';
import {
  getAccessToken,
  GRAPH_BASE,
  SUB_MAX_MS,
  webhookBaseUrl,
  type ServiceLogger,
} from './microsoft-graph-auth.service.js';
import { fetchWithTimeout, providerTimeoutMs } from '../lib/fetch-timeout.js';

// ─── Subscriptions ────────────────────────────────────────────────────────────

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
  // WHY findFirst + orgId in where (not findUnique by bare id): prevents a
  // cross-tenant integrationTokenId from resolving to another org's token —
  // see MISTAKES.md cross-tenant OAuth token disclosure finding.
  const token = await prisma.integrationToken.findFirst({
    where: { id: integrationTokenId, orgId },
  });

  if (!token || token.status !== 'active') {
    log.warn({ integrationTokenId }, 'Cannot create subscription: token not active');
    return null;
  }

  const accessToken = await getAccessToken(token, log);
  const clientState = randomBytes(64).toString('base64url');
  const expiresAt = new Date(Date.now() + SUB_MAX_MS);
  const notificationUrl = `${webhookBaseUrl()}/api/v1/integrations/microsoft/webhook`;

  const res = await fetchWithTimeout(`${GRAPH_BASE}/subscriptions`, {
    provider: 'Microsoft Graph',
    operation: 'subscriptions.create',
    timeoutMs: providerTimeoutMs('MICROSOFT_GRAPH_HTTP_TIMEOUT_MS', 15_000),
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
export async function renewSubscription(subscriptionId: string, log: ServiceLogger): Promise<void> {
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

  const res = await fetchWithTimeout(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
    provider: 'Microsoft Graph',
    operation: 'subscriptions.renew',
    timeoutMs: providerTimeoutMs('MICROSOFT_GRAPH_HTTP_TIMEOUT_MS', 15_000),
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
    await createSubscription({ integrationTokenId: sub.integrationTokenId, orgId: sub.orgId }, log);
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
    const res = await fetchWithTimeout(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
      provider: 'Microsoft Graph',
      operation: 'subscriptions.delete',
      timeoutMs: providerTimeoutMs('MICROSOFT_GRAPH_HTTP_TIMEOUT_MS', 15_000),
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 404) {
      log.warn({ status: res.status, subscriptionId }, 'Graph subscription delete non-200');
    }
  } catch (err) {
    log.warn(
      { err, subscriptionId },
      'Graph subscription remote delete failed; cleaning up locally',
    );
  }

  await prisma.graphSubscription.deleteMany({ where: { subscriptionId } });
}

// ─── Webhook clientState verification ────────────────────────────────────────

/**
 * Constant-time comparison of two strings to prevent timing attacks.
 * WHY timingSafeEqual: clientState is used as a secret; a naive === check
 * leaks timing information that could help an attacker brute-force the value.
 */
export function verifyClientState(received: string, stored: string): boolean {
  if (received.length !== stored.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(stored));
}
