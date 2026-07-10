/**
 * Gmail-specific send and pull implementation.
 *
 * Imported by email-integration.service.ts only.
 * Uses helpers for token management and pixel injection.
 */

import { prisma, EmailProvider } from '@bidstack/db';
import {
  injectTrackingPixel,
  type GmailMessage,
  type SendEmailParams,
  type ServiceLogger,
} from './email-integration.helpers.js';
import { fetchWithTimeout, providerTimeoutMs } from '../lib/fetch-timeout.js';

// ─── Send via Gmail ────────────────────────────────────────────────────────────

export async function sendViaGmail(
  accessToken: string,
  params: SendEmailParams,
  pixelToken: string,
  log: ServiceLogger,
): Promise<{ externalMessageId: string; threadId?: string }> {
  const baseUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  const htmlWithPixel = params.html
    ? injectTrackingPixel(params.html, pixelToken, baseUrl)
    : undefined;

  // Build RFC 2822 message
  const toHeader = params.to.map((r) => (r.name ? `"${r.name}" <${r.email}>` : r.email)).join(', ');
  const ccHeader = params.cc?.length
    ? params.cc.map((r) => (r.name ? `"${r.name}" <${r.email}>` : r.email)).join(', ')
    : undefined;

  const lines = [
    `To: ${toHeader}`,
    ccHeader ? `Cc: ${ccHeader}` : null,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    htmlWithPixel ?? params.text ?? '',
  ]
    .filter((l) => l !== null)
    .join('\r\n');

  const encoded = Buffer.from(lines).toString('base64url');

  const res = await fetchWithTimeout(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      provider: 'Gmail',
      operation: 'messages.send',
      timeoutMs: providerTimeoutMs('GMAIL_HTTP_TIMEOUT_MS', 15_000),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    log.error({ status: res.status, body }, 'Gmail send failed');
    throw new Error(`Gmail send failed: ${res.status}`);
  }

  const data = (await res.json()) as { id: string; threadId?: string };
  return { externalMessageId: data.id, threadId: data.threadId };
}

// ─── Pull from Gmail ───────────────────────────────────────────────────────────

export async function pullGmail(
  tokenId: string,
  accessToken: string,
  orgId: string,
  userId: string,
  deltaState: Record<string, unknown>,
  log: ServiceLogger,
): Promise<void> {
  let historyId = deltaState.gmailHistoryId as string | undefined;
  let messages: GmailMessage[] = [];

  if (!historyId) {
    // First pull: fetch recent messages (last 50)
    const listRes = await fetchWithTimeout(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=in:inbox',
      {
        provider: 'Gmail',
        operation: 'messages.list',
        timeoutMs: providerTimeoutMs('GMAIL_HTTP_TIMEOUT_MS', 15_000),
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!listRes.ok) {
      log.error({ status: listRes.status }, 'Gmail list messages failed');
      return;
    }
    const listData = (await listRes.json()) as {
      messages?: GmailMessage[];
      nextPageToken?: string;
    };
    messages = listData.messages ?? [];
  } else {
    // Incremental: list history changes
    const histRes = await fetchWithTimeout(
      `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${historyId}&historyTypes=messageAdded`,
      {
        provider: 'Gmail',
        operation: 'history.list',
        timeoutMs: providerTimeoutMs('GMAIL_HTTP_TIMEOUT_MS', 15_000),
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!histRes.ok) {
      if (histRes.status === 404) {
        // History ID expired — reset to full pull
        await prisma.integrationToken.update({
          where: { id: tokenId },
          data: { deltaState: {} },
        });
      }
      log.warn({ status: histRes.status }, 'Gmail history pull issue');
      return;
    }
    const histData = (await histRes.json()) as {
      history?: Array<{ messagesAdded?: Array<{ message: GmailMessage }> }>;
      historyId?: string;
    };
    historyId = histData.historyId;
    for (const entry of histData.history ?? []) {
      for (const ma of entry.messagesAdded ?? []) {
        messages.push(ma.message);
      }
    }
  }

  // Fetch full message details for each and upsert
  for (const msg of messages.slice(0, 30)) {
    try {
      const detailRes = await fetchWithTimeout(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        {
          provider: 'Gmail',
          operation: 'messages.get',
          timeoutMs: providerTimeoutMs('GMAIL_HTTP_TIMEOUT_MS', 15_000),
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (!detailRes.ok) continue;

      const detail = (await detailRes.json()) as {
        id: string;
        threadId: string;
        internalDate?: string;
        payload?: {
          headers?: Array<{ name: string; value: string }>;
          body?: { data?: string };
          parts?: Array<{ mimeType: string; body?: { data?: string } }>;
        };
      };

      const headers = detail.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

      const fromRaw = getHeader('From');
      const toRaw = getHeader('To');
      const subject = getHeader('Subject');
      const dateMs = detail.internalDate ? parseInt(detail.internalDate) : Date.now();

      const fromEmail = fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw.trim();
      const toEmails = toRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => ({ email: s.match(/<([^>]+)>/)?.[1] ?? s }));

      // Match to CRM entity by sender email
      const contact = await prisma.contact.findFirst({
        where: { orgId, email: fromEmail, deletedAt: null },
      });

      // WHY findFirst + orgId in where (not findUnique by bare id): mirrors the
      // fix in email-integration.graph.ts's pullMsGraphMail — tokenId alone
      // must never resolve a cross-tenant IntegrationToken row.
      const token = await prisma.integrationToken.findFirst({ where: { id: tokenId, orgId } });

      await prisma.emailMessage.upsert({
        where: { orgId_externalMessageId: { orgId, externalMessageId: detail.id } },
        create: {
          orgId,
          userId,
          integrationTokenId: tokenId,
          provider: EmailProvider.GMAIL,
          externalMessageId: detail.id,
          threadId: detail.threadId,
          fromEmail,
          toEmails,
          ccEmails: [],
          subject,
          receivedAt: new Date(dateMs),
          isOutbound: fromEmail === token?.externalAccountEmail,
          entityType: contact ? 'contact' : null,
          entityId: contact?.id ?? null,
        },
        update: {},
      });
    } catch (err) {
      log.warn({ err, msgId: msg.id }, 'Failed to process Gmail message');
    }
  }

  // Persist updated history cursor
  const newHistId = historyId ?? messages[0]?.id;
  if (newHistId) {
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: {
        deltaState: { gmailHistoryId: newHistId },
        lastSyncedAt: new Date(),
      },
    });
  }
}
