/**
 * MS Graph-specific send and pull implementation.
 *
 * Imported by email-integration.service.ts only.
 * Uses helpers for token management and pixel injection.
 */

import { randomBytes } from 'node:crypto';
import { prisma, EmailProvider } from '@bidstack/db';
import {
  injectTrackingPixel,
  type SendEmailParams,
  type ServiceLogger,
} from './email-integration.helpers.js';
import { fetchWithTimeout, providerTimeoutMs } from '../lib/fetch-timeout.js';

// ─── Send via MS Graph ─────────────────────────────────────────────────────────

export async function sendViaMsGraph(
  accessToken: string,
  params: SendEmailParams,
  pixelToken: string,
  log: ServiceLogger,
): Promise<{ externalMessageId: string; threadId?: string }> {
  const baseUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  const htmlWithPixel = params.html
    ? injectTrackingPixel(params.html, pixelToken, baseUrl)
    : undefined;

  const body = {
    message: {
      subject: params.subject,
      body: {
        contentType: 'HTML',
        content: htmlWithPixel ?? params.text ?? '',
      },
      toRecipients: params.to.map((r) => ({
        emailAddress: { address: r.email, name: r.name },
      })),
      ccRecipients:
        params.cc?.map((r) => ({
          emailAddress: { address: r.email, name: r.name },
        })) ?? [],
      bccRecipients:
        params.bcc?.map((r) => ({
          emailAddress: { address: r.email, name: r.name },
        })) ?? [],
    },
    saveToSentItems: true,
  };

  const res = await fetchWithTimeout('https://graph.microsoft.com/v1.0/me/sendMail', {
    provider: 'Microsoft Graph',
    operation: 'mail.send',
    timeoutMs: providerTimeoutMs('MICROSOFT_GRAPH_HTTP_TIMEOUT_MS', 15_000),
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const resBody = await res.text();
    log.error({ status: res.status, body: resBody }, 'MS Graph sendMail failed');
    throw new Error(`MS Graph sendMail failed: ${res.status}`);
  }

  // Graph sendMail returns 202 Accepted with no body — message id not available
  // synchronously. We use a UUID as a stable local id.
  return { externalMessageId: randomBytes(16).toString('hex') };
}

// ─── Pull from MS Graph ────────────────────────────────────────────────────────

export async function pullMsGraphMail(
  tokenId: string,
  accessToken: string,
  orgId: string,
  userId: string,
  deltaState: Record<string, unknown>,
  log: ServiceLogger,
): Promise<void> {
  const deltaLink = deltaState.mailDeltaLink as string | undefined;
  const url =
    deltaLink ??
    'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top=50&$select=id,conversationId,from,toRecipients,subject,receivedDateTime,sentDateTime,body,isDraft';

  const res = await fetchWithTimeout(url, {
    provider: 'Microsoft Graph',
    operation: 'mail.delta',
    timeoutMs: providerTimeoutMs('MICROSOFT_GRAPH_HTTP_TIMEOUT_MS', 15_000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    log.error({ status: res.status }, 'MS Graph mail delta failed');
    return;
  }

  const data = (await res.json()) as {
    value?: Array<{
      id: string;
      conversationId?: string;
      from?: { emailAddress?: { address?: string; name?: string } };
      toRecipients?: Array<{ emailAddress?: { address?: string } }>;
      subject?: string;
      receivedDateTime?: string;
      sentDateTime?: string;
      body?: { content?: string; contentType?: string };
    }>;
    '@odata.deltaLink'?: string;
  };

  // WHY findFirst + orgId in where (not findUnique by bare id): tokenId alone
  // must never resolve a cross-tenant IntegrationToken row — see MISTAKES.md
  // cross-tenant OAuth token disclosure finding.
  const token = await prisma.integrationToken.findFirst({ where: { id: tokenId, orgId } });

  for (const msg of (data.value ?? []).slice(0, 30)) {
    try {
      const fromEmail = msg.from?.emailAddress?.address ?? '';
      const toEmails = (msg.toRecipients ?? []).map((r) => ({
        email: r.emailAddress?.address ?? '',
      }));

      const contact = await prisma.contact.findFirst({
        where: { orgId, email: fromEmail, deletedAt: null },
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
          ccEmails: [],
          subject: msg.subject ?? '',
          bodyHtml: msg.body?.contentType === 'html' ? msg.body.content : null,
          bodyText: msg.body?.contentType === 'text' ? msg.body.content : null,
          receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
          sentAt: msg.sentDateTime ? new Date(msg.sentDateTime) : null,
          isOutbound: fromEmail === token?.externalAccountEmail,
          entityType: contact ? 'contact' : null,
          entityId: contact?.id ?? null,
        },
        update: {},
      });
    } catch (err) {
      log.warn({ err, msgId: msg.id }, 'Failed to process Graph mail message');
    }
  }

  if (data['@odata.deltaLink']) {
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: {
        deltaState: { mailDeltaLink: data['@odata.deltaLink'] },
        lastSyncedAt: new Date(),
      },
    });
  }
}
