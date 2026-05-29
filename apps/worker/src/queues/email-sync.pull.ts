/**
 * email-sync.pull.ts — MS Graph delta pull logic.
 *
 * Extracted from email-sync.ts (BS-R1 file-size refactor).
 * Handles incremental and historical inbox pulls via @odata.deltaLink.
 */
import type pino from 'pino';

import { prisma } from '@bidstack/db';

import { getAccessToken, RateLimitError } from './email-sync.helpers.js';

const DELTA_SELECT =
  'id,conversationId,from,toRecipients,ccRecipients,subject,receivedDateTime,sentDateTime,isDraft,body';
const INITIAL_DELTA_URL = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top=100&$select=${DELTA_SELECT}`;

export async function pullDelta(
  params: { orgId: string; userId: string; integrationTokenId: string },
  log: pino.Logger,
): Promise<{ persisted: number }> {
  const token = await prisma.integrationToken.findUnique({
    where: { id: params.integrationTokenId },
  });

  if (!token || token.orgId !== params.orgId || token.status !== 'active') {
    log.warn({ tokenId: params.integrationTokenId }, 'Skipping Graph pull: token inactive');
    return { persisted: 0 };
  }

  const accessToken = await getAccessToken(token, log);
  const deltaState = (token.deltaState ?? {}) as Record<string, unknown>;
  const startUrl = (deltaState.mailDeltaLink as string | undefined) ?? INITIAL_DELTA_URL;

  const res = await fetch(startUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const retryAfterMs = retryAfter ? parseInt(retryAfter) * 1_000 : 60_000;
    throw new RateLimitError(retryAfterMs);
  }

  if (res.status === 410) {
    log.warn({ tokenId: token.id }, 'Graph deltaLink expired (410); resetting');
    await prisma.integrationToken.update({
      where: { id: token.id },
      data: { deltaState: {} },
    });
    return { persisted: 0 };
  }

  if (!res.ok) {
    log.error({ status: res.status, tokenId: token.id }, 'Graph delta query failed');
    throw new Error(`Graph delta query failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    value?: Array<{
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
    }>;
    '@odata.deltaLink'?: string;
  };

  let persisted = 0;
  const accountEmail = token.externalAccountEmail ?? '';

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
        where: { orgId: params.orgId, email: fromEmail, deletedAt: null },
        select: { id: true },
      });

      await prisma.emailMessage.upsert({
        where: {
          orgId_externalMessageId: { orgId: params.orgId, externalMessageId: msg.id },
        },
        create: {
          orgId: params.orgId,
          userId: params.userId,
          integrationTokenId: params.integrationTokenId,
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

  if (data['@odata.deltaLink']) {
    await prisma.integrationToken.update({
      where: { id: token.id },
      data: {
        deltaState: { mailDeltaLink: data['@odata.deltaLink'] },
        lastSyncedAt: new Date(),
      },
    });
  }

  return { persisted };
}
