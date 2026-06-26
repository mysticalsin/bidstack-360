// Microsoft Graph Mail — email send + incremental delta sync.
//
// Token lifecycle      → microsoft-graph-auth.service.ts
// Subscriptions        → microsoft-graph-subscription.service.ts
//
// Token lifecycle:
//   Access tokens expire in ~1 h. getAccessToken() refreshes proactively
//   when fewer than 60 seconds remain.
//
// Delta query (incremental sync):
//   Stored in IntegrationToken.deltaState.mailDeltaLink.
//   On first connect the historical pull seeds the inbox (last 100 msgs).
//   Subsequent calls follow @odata.deltaLink for only changed messages.

import { randomBytes } from 'node:crypto';
import { prisma, EmailProvider } from '@bidstack/db';
import type { Prisma } from '@bidstack/db';
import { getAccessToken, GRAPH_BASE, type ServiceLogger } from './microsoft-graph-auth.service.js';
import { assertSerumConnectorAllowed } from '../lib/serum-connector-policy.js';

// ─── Email send ────────────────────────────────────────────────────────────────

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

  await assertSerumConnectorAllowed({
    orgId: params.orgId,
    connectorId: 'microsoft_graph',
    operation: 'mail.send',
    writeRequested: true,
  });

  const accessToken = await getAccessToken(token, log);
  const pixelToken = randomBytes(24).toString('base64url');
  const htmlWithPixel = params.html ? injectTrackingPixel(params.html, pixelToken) : undefined;

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
              { id: 'String 0x1042', value: `<${params.replyToMessageId}>` },
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
        provider: EmailProvider.OUTLOOK,
        externalMessageId,
        fromEmail: token.externalAccountEmail ?? '',
        toEmails: params.to as unknown as Prisma.InputJsonValue,
        ccEmails: (params.cc ?? []) as unknown as Prisma.InputJsonValue,
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

// ─── Incremental pull (delta query) ───────────────────────────────────────────

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
  `${GRAPH_BASE}/me/mailFolders/inbox/messages/delta?` + `$top=100&$select=${DELTA_SELECT}`;

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

  await assertSerumConnectorAllowed({
    orgId,
    connectorId: 'microsoft_graph',
    operation: 'mail.pullIncremental',
    writeRequested: false,
  });

  const accessToken = await getAccessToken(token, log);
  const deltaState = (token.deltaState ?? {}) as Record<string, unknown>;
  const startUrl = (deltaState.mailDeltaLink as string | undefined) ?? INITIAL_DELTA_URL;

  return fetchDeltaPage(
    startUrl,
    accessToken,
    token.id,
    orgId,
    userId,
    token.externalAccountEmail ?? '',
    log,
  );
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

  for (const msg of data.value ?? []) {
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
        where: { orgId_externalMessageId: { orgId, externalMessageId: msg.id } },
        create: {
          orgId,
          userId,
          integrationTokenId: tokenId,
          provider: EmailProvider.OUTLOOK,
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
