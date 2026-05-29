/**
 * email-sync.subscriptions.ts — MS Graph subscription renewal.
 *
 * Extracted from email-sync.ts (BS-R1 file-size refactor).
 * Handles renewing (or recreating on 404) Graph change-notification subscriptions.
 */
import type pino from 'pino';

import { prisma } from '@bidstack/db';

import { getAccessToken } from './email-sync.helpers.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
/** Maximum Graph subscription lifetime is 3 days. */
const SUB_MAX_MS = 3 * 24 * 60 * 60 * 1_000;

export async function renewSub(subscriptionId: string, log: pino.Logger): Promise<void> {
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
    log.warn({ subscriptionId }, 'Graph subscription 404 on renew; deleting local row');
    await prisma.graphSubscription.deleteMany({ where: { subscriptionId } });
    return;
  }

  if (!res.ok) {
    log.error({ status: res.status, subscriptionId }, 'Graph subscription renewal failed');
    throw new Error(`Subscription renewal failed: ${res.status}`);
  }

  await prisma.graphSubscription.update({
    where: { subscriptionId },
    data: { expiresAt: newExpiry, renewalCount: { increment: 1 } },
  });

  log.info({ subscriptionId, newExpiry }, 'Graph subscription renewed');
}
