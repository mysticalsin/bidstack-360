/**
 * Email integration service — send and pull for Gmail and Outlook (MS Graph).
 *
 * WHY a service layer: both the API route (send) and the worker (pull) need
 * the same Gmail/Graph call logic. Extracting to a service avoids duplication
 * and makes the worker thin.
 *
 * Design decisions:
 *  - Tracking pixel injected server-side so the frontend never needs to know
 *    the pixel URL. An HTML comment marks the injection point for easy testing.
 *  - Pull is incremental: Gmail uses historyId, Graph uses delta query.
 *    On first pull, we do a full page-0 fetch and persist the cursor.
 *  - Entity matching by email address: looks up Contact.email that equals any
 *    sender email in the thread, then links the message.
 *
 * Imported by:
 *   apps/api/src/routes/integrations/email.ts
 *   apps/api/src/routes/bookings.helpers.ts
 *   apps/api/src/services/cs/nps.service.ts
 */

import { randomBytes } from 'node:crypto';
import { prisma, IntegrationProvider, EmailProvider } from '@bidstack/db';
import {
  getAccessToken,
  type SendEmailParams,
  type PullEmailsParams,
  type ServiceLogger,
} from './email-integration.helpers.js';
import { sendViaGmail, pullGmail } from './email-integration.gmail.js';
import { sendViaMsGraph, pullMsGraphMail } from './email-integration.graph.js';
import { assertSerumConnectorAllowed } from '../lib/serum-connector-policy.js';
import { reserveOutboundCommunication } from '../lib/outbound-communication-guard.js';

// Re-export types so callers don't need to import from helpers directly
export type {
  EmailAddress,
  SendEmailParams,
  PullEmailsParams,
} from './email-integration.helpers.js';

// ─── Send email ────────────────────────────────────────────────────────────────

export async function sendEmail(
  params: SendEmailParams,
  log: ServiceLogger,
): Promise<{ messageId: string }> {
  // Find the user's active integration token (prefer gmail, fallback microsoft_graph)
  const token = await prisma.integrationToken.findFirst({
    where: {
      orgId: params.orgId,
      userId: params.userId,
      provider: { in: [IntegrationProvider.gmail, IntegrationProvider.microsoft_graph] },
      status: 'active',
      deletedAt: null,
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (!token) {
    throw new Error('No active email integration found. Connect Gmail or Outlook first.');
  }

  const pixelToken = randomBytes(24).toString('base64url');
  const isGmail = token.provider === 'gmail';
  await assertSerumConnectorAllowed({
    orgId: params.orgId,
    connectorId: isGmail ? 'gmail' : 'microsoft_graph',
    operation: 'email.send',
    writeRequested: true,
  });

  const recipientCount = params.to.length + (params.cc?.length ?? 0) + (params.bcc?.length ?? 0);
  const reservation = await reserveOutboundCommunication(
    {
      channel: 'email',
      orgId: params.orgId,
      userId: params.userId,
      units: recipientCount,
    },
    log,
  );

  let providerAccepted = false;
  let providerResult: { externalMessageId: string; threadId?: string };
  try {
    const accessToken = await getAccessToken(token, log);
    providerResult = isGmail
      ? await sendViaGmail(accessToken, params, pixelToken, log)
      : await sendViaMsGraph(accessToken, params, pixelToken, log);
    providerAccepted = true;
  } catch (err) {
    if (!providerAccepted) await reservation.rollback();
    throw err;
  }

  const { externalMessageId, threadId } = providerResult;

  // Persist EmailMessage + tracking pixel in a transaction
  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.emailMessage.create({
      data: {
        orgId: params.orgId,
        userId: params.userId,
        integrationTokenId: token.id,
        provider: isGmail ? EmailProvider.GMAIL : EmailProvider.OUTLOOK,
        externalMessageId,
        threadId: threadId ?? null,
        fromEmail: token.externalAccountEmail ?? '',
        toEmails: params.to as object[],
        ccEmails: (params.cc ?? []) as object[],
        subject: params.subject,
        bodyHtml: params.html ?? null,
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

  log.info({ messageId: message.id, externalMessageId }, 'Email sent and persisted');
  return { messageId: message.id };
}

// ─── Pull emails ───────────────────────────────────────────────────────────────

export async function pullEmails(params: PullEmailsParams, log: ServiceLogger): Promise<void> {
  // WHY findFirst + orgId in where (not findUnique by bare id): prevents a
  // cross-tenant integrationTokenId from resolving to another org's token —
  // see MISTAKES.md cross-tenant OAuth token disclosure finding.
  const token = await prisma.integrationToken.findFirst({
    where: { id: params.integrationTokenId, orgId: params.orgId },
  });

  if (!token || token.status !== 'active') {
    log.warn({ tokenId: params.integrationTokenId }, 'Skipping pull: token inactive or not found');
    return;
  }

  await assertSerumConnectorAllowed({
    orgId: params.orgId,
    connectorId: token.provider === 'gmail' ? 'gmail' : 'microsoft_graph',
    operation: 'email.pull',
    writeRequested: false,
  });

  const accessToken = await getAccessToken(token, log);
  const deltaState = (token.deltaState ?? {}) as Record<string, unknown>;

  if (token.provider === 'gmail') {
    await pullGmail(token.id, accessToken, params.orgId, params.userId, deltaState, log);
  } else if (token.provider === 'microsoft_graph') {
    await pullMsGraphMail(token.id, accessToken, params.orgId, params.userId, deltaState, log);
  }
}
