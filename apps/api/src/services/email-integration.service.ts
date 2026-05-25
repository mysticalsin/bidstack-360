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
 */

import { randomBytes } from 'node:crypto';
import { prisma } from '@bidstack/db';
import { decryptToken, encryptToken } from '@bidstack/shared/token-crypto';
import type pino from 'pino';

type ServiceLogger = Pick<pino.Logger, 'debug' | 'error' | 'info' | 'warn'>;

// ─── Types ────────────────────────────────────────────────────────────────

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface SendEmailParams {
  orgId: string;
  userId: string;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  entityType?: string;
  entityId?: string;
}

export interface PullEmailsParams {
  orgId: string;
  userId: string;
  integrationTokenId: string;
  since?: Date;
}

// ─── Token refresh helpers ─────────────────────────────────────────────────

async function refreshGmailToken(
  tokenId: string,
  refreshToken: string,
  log: ServiceLogger,
): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID ?? '',
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error({ tokenId, status: res.status, body }, 'Gmail token refresh failed');
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: { status: 'error', errorMessage: `refresh failed: ${res.status}` },
    });
    throw new Error(`Gmail refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined;

  await prisma.integrationToken.update({
    where: { id: tokenId },
    data: {
      accessTokenEncrypted: encryptToken(data.access_token),
      expiresAt,
      status: 'active',
      lastRefreshedAt: new Date(),
      errorMessage: null,
    },
  });

  return data.access_token;
}

async function refreshMsGraphToken(
  tokenId: string,
  refreshToken: string,
  log: ServiceLogger,
): Promise<string> {
  const tenant = process.env.MICROSOFT_TENANT_ID ?? 'common';
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_GRAPH_CLIENT_ID ?? '',
        client_secret: process.env.MICROSOFT_GRAPH_CLIENT_SECRET ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read offline_access',
      }).toString(),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    log.error({ tokenId, status: res.status, body }, 'MS Graph token refresh failed');
    await prisma.integrationToken.update({
      where: { id: tokenId },
      data: { status: 'error', errorMessage: `refresh failed: ${res.status}` },
    });
    throw new Error(`MS Graph refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined;

  await prisma.integrationToken.update({
    where: { id: tokenId },
    data: {
      accessTokenEncrypted: encryptToken(data.access_token),
      expiresAt,
      status: 'active',
      lastRefreshedAt: new Date(),
      errorMessage: null,
    },
  });

  return data.access_token;
}

/**
 * Get a live access token, refreshing if expired.
 */
async function getAccessToken(
  tokenRecord: {
    id: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string | null;
    expiresAt: Date | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider: any;
  },
  log: ServiceLogger,
): Promise<string> {
  const isExpired = tokenRecord.expiresAt
    ? tokenRecord.expiresAt.getTime() < Date.now() + 60_000 // 1 min buffer
    : false;

  if (!isExpired) return decryptToken(tokenRecord.accessTokenEncrypted);

  if (!tokenRecord.refreshTokenEncrypted) {
    throw new Error('Token expired and no refresh token available');
  }

  const refresh = decryptToken(tokenRecord.refreshTokenEncrypted);
  if (tokenRecord.provider === 'gmail') {
    return refreshGmailToken(tokenRecord.id, refresh, log);
  }
  return refreshMsGraphToken(tokenRecord.id, refresh, log);
}

// ─── Tracking pixel injection ──────────────────────────────────────────────

function injectTrackingPixel(html: string, pixelToken: string, baseUrl: string): string {
  const pixelUrl = `${baseUrl}/track/email/open/${pixelToken}`;
  const pixelTag = `<!-- bidstack-tracking-pixel --><img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`;

  // Inject before </body> if present, otherwise append
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixelTag}</body>`);
  }
  return html + pixelTag;
}

// ─── Send email ────────────────────────────────────────────────────────────

async function sendViaGmail(
  accessToken: string,
  params: SendEmailParams,
  pixelToken: string,
  log: ServiceLogger,
): Promise<{ externalMessageId: string; threadId?: string }> {
  const baseUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  const htmlWithPixel = params.html ? injectTrackingPixel(params.html, pixelToken, baseUrl) : undefined;

  // Build RFC 2822 message
  const toHeader = params.to.map((r) => r.name ? `"${r.name}" <${r.email}>` : r.email).join(', ');
  const ccHeader = params.cc?.length
    ? params.cc.map((r) => r.name ? `"${r.name}" <${r.email}>` : r.email).join(', ')
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

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error({ status: res.status, body }, 'Gmail send failed');
    throw new Error(`Gmail send failed: ${res.status}`);
  }

  const data = (await res.json()) as { id: string; threadId?: string };
  return { externalMessageId: data.id, threadId: data.threadId };
}

async function sendViaMsGraph(
  accessToken: string,
  params: SendEmailParams,
  pixelToken: string,
  log: ServiceLogger,
): Promise<{ externalMessageId: string; threadId?: string }> {
  const baseUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  const htmlWithPixel = params.html ? injectTrackingPixel(params.html, pixelToken, baseUrl) : undefined;

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
      ccRecipients: params.cc?.map((r) => ({
        emailAddress: { address: r.email, name: r.name },
      })) ?? [],
      bccRecipients: params.bcc?.map((r) => ({
        emailAddress: { address: r.email, name: r.name },
      })) ?? [],
    },
    saveToSentItems: true,
  };

  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
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

export async function sendEmail(
  params: SendEmailParams,
  log: ServiceLogger,
): Promise<{ messageId: string }> {
  // Find the user's active integration token (prefer gmail, fallback microsoft_graph)
  const token = await prisma.integrationToken.findFirst({
    where: {
      orgId: params.orgId,
      userId: params.userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: { in: ['gmail', 'microsoft_graph'] as any[] },
      status: 'active',
      deletedAt: null,
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (!token) {
    throw new Error('No active email integration found. Connect Gmail or Outlook first.');
  }

  const accessToken = await getAccessToken(token, log);
  const pixelToken = randomBytes(24).toString('base64url');
  const isGmail = token.provider === 'gmail';

  const { externalMessageId, threadId } = isGmail
    ? await sendViaGmail(accessToken, params, pixelToken, log)
    : await sendViaMsGraph(accessToken, params, pixelToken, log);

  // Persist EmailMessage + tracking pixel in a transaction
  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.emailMessage.create({
      data: {
        orgId: params.orgId,
        userId: params.userId,
        integrationTokenId: token.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: (isGmail ? 'GMAIL' : 'OUTLOOK') as any,
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

// ─── Pull emails ───────────────────────────────────────────────────────────

interface GmailMessage {
  id: string;
  threadId: string;
}

async function pullGmail(
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
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=in:inbox',
      { headers: { Authorization: `Bearer ${accessToken}` } },
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
    const histRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${historyId}&historyTypes=messageAdded`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
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
      const detailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
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

      const token = await prisma.integrationToken.findUnique({ where: { id: tokenId } });

      await prisma.emailMessage.upsert({
        where: {
           
          orgId_externalMessageId: { orgId, externalMessageId: detail.id },
        },
        create: {
          orgId,
          userId,
          integrationTokenId: tokenId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'GMAIL' as any,
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
  const newHistId = historyId ?? (messages[0]?.id);
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

async function pullMsGraphMail(
  tokenId: string,
  accessToken: string,
  orgId: string,
  userId: string,
  deltaState: Record<string, unknown>,
  log: ServiceLogger,
): Promise<void> {
  const deltaLink = deltaState.mailDeltaLink as string | undefined;
  const url = deltaLink ?? 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top=50&$select=id,conversationId,from,toRecipients,subject,receivedDateTime,sentDateTime,body,isDraft';

  const res = await fetch(url, {
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

  const token = await prisma.integrationToken.findUnique({ where: { id: tokenId } });

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

export async function pullEmails(params: PullEmailsParams, log: ServiceLogger): Promise<void> {
  const token = await prisma.integrationToken.findUnique({
    where: { id: params.integrationTokenId },
  });

  if (!token || token.orgId !== params.orgId || token.status !== 'active') {
    log.warn({ tokenId: params.integrationTokenId }, 'Skipping pull: token inactive or not found');
    return;
  }

  const accessToken = await getAccessToken(token, log);
  const deltaState = (token.deltaState ?? {}) as Record<string, unknown>;

  if (token.provider === 'gmail') {
    await pullGmail(token.id, accessToken, params.orgId, params.userId, deltaState, log);
  } else if (token.provider === 'microsoft_graph') {
    await pullMsGraphMail(token.id, accessToken, params.orgId, params.userId, deltaState, log);
  }
}
