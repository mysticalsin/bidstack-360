/**
 * email-sync.pull.ts — Outlook (Microsoft Graph) mail capture via delta query.
 *
 * Inbox and Sent Items each keep their own deltaLink, merged into the token's
 * deltaState so the calendar cursors on the same row survive. Every nextLink
 * page is followed; a run that hits the page cap stores the nextLink and
 * resumes from it. Messages dedupe on (org, provider message id).
 */
import type pino from 'pino';

import { prisma, EmailProvider, syncEmailMessageActivity } from '@bidstack/db';

import { bridgeActivity, captureColumns, resolveCaptureTarget } from '../lib/comms-capture.js';
import { providerFetch } from '../lib/provider-http.js';
import { getWorkspaceAccessToken } from '../lib/workspace-token.js';

const DELTA_SELECT =
  'id,conversationId,from,toRecipients,ccRecipients,subject,receivedDateTime,sentDateTime,isDraft,body';
const MAX_PAGES_PER_FOLDER = 10;

const FOLDERS = [
  { folder: 'inbox', link: 'mailDeltaLink', next: 'mailNextLink' },
  { folder: 'sentitems', link: 'mailSentDeltaLink', next: 'mailSentNextLink' },
] as const;

function initialUrl(folder: string): string {
  return `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages/delta?$top=100&$select=${DELTA_SELECT}`;
}

interface GraphRecipient {
  emailAddress?: { address?: string; name?: string };
}

interface GraphMessage {
  id: string;
  conversationId?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  subject?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  isDraft?: boolean;
  body?: { content?: string; contentType?: string };
  '@removed'?: unknown;
}

function recipients(list: GraphRecipient[] | undefined): Array<{ email: string; name?: string }> {
  return (list ?? [])
    .map((r) => ({ email: (r.emailAddress?.address ?? '').toLowerCase(), name: r.emailAddress?.name }))
    .filter((r) => r.email);
}

export async function pullDelta(
  params: { orgId: string; userId: string; integrationTokenId: string },
  log: pino.Logger,
): Promise<{ persisted: number }> {
  const token = await prisma.integrationToken.findFirst({
    where: { id: params.integrationTokenId, orgId: params.orgId },
  });

  if (!token || (token.status !== 'active' && token.status !== 'error')) {
    log.warn({ tokenId: params.integrationTokenId }, 'Skipping Graph pull: token inactive');
    return { persisted: 0 };
  }

  const accessToken = await getWorkspaceAccessToken(token, log);
  const deltaState: Record<string, unknown> = { ...((token.deltaState ?? {}) as Record<string, unknown>) };
  const ownerEmail = token.externalAccountEmail?.toLowerCase() ?? null;
  let persisted = 0;

  for (const f of FOLDERS) {
    let url = (deltaState[f.next] as string | undefined) ?? (deltaState[f.link] as string | undefined) ?? initialUrl(f.folder);
    let done = false;

    for (let page = 0; page < MAX_PAGES_PER_FOLDER; page++) {
      const res = await providerFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } }, { provider: 'Microsoft Graph' });

      if (res.status === 410) {
        log.warn({ tokenId: token.id, folder: f.folder }, 'Graph mail delta expired (410); resyncing folder');
        delete deltaState[f.link];
        delete deltaState[f.next];
        done = true;
        break;
      }
      if (!res.ok) {
        log.error({ status: res.status, tokenId: token.id, folder: f.folder }, 'Graph delta query failed');
        throw new Error(`Graph delta query failed: ${res.status}`);
      }

      const data = (await res.json()) as {
        value?: GraphMessage[];
        '@odata.nextLink'?: string;
        '@odata.deltaLink'?: string;
      };

      for (const msg of data.value ?? []) {
        if (msg.isDraft || msg['@removed'] || !msg.id) continue;
        try {
          const fromEmail = (msg.from?.emailAddress?.address ?? '').toLowerCase();
          const toEmails = recipients(msg.toRecipients);
          const ccEmails = recipients(msg.ccRecipients);
          const target = await resolveCaptureTarget({
            orgId: params.orgId,
            ownerEmail,
            participants: [fromEmail, ...toEmails.map((r) => r.email), ...ccEmails.map((r) => r.email)],
          });
          // Mail that matches no CRM record stays out of Polo (pay slips, HR, personal mail).
          if (!target) continue;
          const html = msg.body?.contentType?.toLowerCase() === 'html';

          const saved = await prisma.emailMessage.upsert({
            where: { orgId_externalMessageId: { orgId: params.orgId, externalMessageId: msg.id } },
            create: {
              orgId: params.orgId,
              userId: params.userId,
              integrationTokenId: params.integrationTokenId,
              provider: EmailProvider.OUTLOOK,
              externalMessageId: msg.id,
              threadId: msg.conversationId ?? null,
              fromEmail,
              toEmails,
              ccEmails,
              subject: msg.subject ?? '',
              bodyHtml: html ? (msg.body?.content ?? null) : null,
              bodyText: html ? null : (msg.body?.content ?? null),
              receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
              sentAt: msg.sentDateTime ? new Date(msg.sentDateTime) : null,
              isOutbound: Boolean(ownerEmail) && fromEmail === ownerEmail,
              entityType: target.entityType,
              entityId: target.entityId,
              ...captureColumns(target),
            },
            update: {},
            select: { id: true },
          });
          await bridgeActivity(() => syncEmailMessageActivity(params.orgId, saved.id), log, { msgId: msg.id });
          persisted++;
        } catch (err) {
          log.warn({ err, msgId: msg.id }, 'Failed to persist Graph message');
        }
      }

      if (data['@odata.deltaLink']) {
        deltaState[f.link] = data['@odata.deltaLink'];
        delete deltaState[f.next];
        done = true;
        break;
      }
      if (!data['@odata.nextLink']) {
        done = true;
        break;
      }
      url = data['@odata.nextLink'];
    }

    if (!done) {
      deltaState[f.next] = url;
      log.info({ tokenId: token.id, folder: f.folder }, 'Graph mail pull paused at page cap; resuming next tick');
    }
  }

  await prisma.integrationToken.update({
    where: { id: token.id },
    data: { deltaState: deltaState as object, lastSyncedAt: new Date() },
  });

  return { persisted };
}
