/**
 * Gmail inbox capture (read-only grant).
 *
 * First run: read the mailbox historyId from the profile BEFORE listing the
 * last 30 days, so nothing that arrives during the seed is missed. Later runs:
 * history.list from the stored historyId (messageAdded only). Messages are
 * deduped by provider message id and filed by participants.
 */
import type pino from 'pino';

import { prisma, EmailProvider, syncEmailMessageActivity } from '@bidstack/db';

import { bridgeActivity, captureColumns, noteActivityBridgeFailures, resolveCaptureTarget } from '../lib/comms-capture.js';
import { providerFetch } from '../lib/provider-http.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_LIST_PAGES = 5;
const MAX_MESSAGES_PER_RUN = 500;
const MAX_BODY_CHARS = 200_000;
const SKIP_LABELS = new Set(['DRAFT', 'SPAM', 'TRASH']);

interface GmailTokenRow {
  id: string;
  orgId: string;
  userId: string;
  externalAccountEmail: string | null;
  deltaState: unknown;
}

interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessageDetail {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

/** "Name <a@b.c>, other@d.e" to [{ email, name? }]; commas inside quotes are kept. */
export function parseAddressList(raw: string): Array<{ email: string; name?: string }> {
  const out: Array<{ email: string; name?: string }> = [];
  let current = '';
  let quoted = false;
  const flush = () => {
    const part = current.trim();
    current = '';
    if (!part) return;
    const angle = part.match(/^(.*)<([^>]+)>\s*$/);
    if (angle) {
      const name = (angle[1] ?? '').trim().replace(/^"|"$/g, '');
      out.push({ email: (angle[2] ?? '').trim().toLowerCase(), ...(name ? { name } : {}) });
    } else if (part.includes('@')) {
      out.push({ email: part.toLowerCase() });
    }
  };
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) flush();
    else current += ch;
  }
  flush();
  return out;
}

function decode(data: string | undefined): string | null {
  if (!data) return null;
  return Buffer.from(data, 'base64url').toString('utf8').slice(0, MAX_BODY_CHARS);
}

function findBody(part: GmailPart | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return decode(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findBody(child, mime);
    if (found) return found;
  }
  return null;
}

async function getJson<T>(url: string, accessToken: string): Promise<{ status: number; body: T | null }> {
  const res = await providerFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } }, { provider: 'Gmail' });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: (await res.json()) as T };
}

async function seedIds(accessToken: string): Promise<{ ids: string[]; historyId: string | null }> {
  const profile = await getJson<{ historyId?: string }>(`${API}/profile`, accessToken);
  if (!profile.body) throw new Error(`Gmail profile failed: ${profile.status}`);
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES && ids.length < MAX_MESSAGES_PER_RUN; page++) {
    const params = new URLSearchParams({ q: 'newer_than:30d', maxResults: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const list = await getJson<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      `${API}/messages?${params.toString()}`,
      accessToken,
    );
    if (!list.body) throw new Error(`Gmail list failed: ${list.status}`);
    ids.push(...(list.body.messages ?? []).map((m) => m.id));
    if (!list.body.nextPageToken) break;
    pageToken = list.body.nextPageToken;
  }
  return { ids, historyId: profile.body.historyId ?? null };
}

async function historyIds(
  accessToken: string,
  startHistoryId: string,
): Promise<{ ids: string[]; historyId: string | null; expired: boolean }> {
  const ids: string[] = [];
  let latest: string | null = null;
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES * 4 && ids.length < MAX_MESSAGES_PER_RUN; page++) {
    const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', maxResults: '500' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await getJson<{
      history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>;
      historyId?: string;
      nextPageToken?: string;
    }>(`${API}/history?${params.toString()}`, accessToken);
    if (res.status === 404) return { ids: [], historyId: null, expired: true };
    if (!res.body) throw new Error(`Gmail history failed: ${res.status}`);
    for (const h of res.body.history ?? []) for (const m of h.messagesAdded ?? []) ids.push(m.message.id);
    latest = res.body.historyId ?? latest;
    if (!res.body.nextPageToken) break;
    pageToken = res.body.nextPageToken;
  }
  return { ids: [...new Set(ids)], historyId: latest, expired: false };
}

/** Pull new Gmail messages for one grant. Returns how many were stored. */
export async function pullGmail(token: GmailTokenRow, accessToken: string, log: pino.Logger): Promise<number> {
  const deltaState = (token.deltaState ?? {}) as Record<string, unknown>;
  const cursor = deltaState['gmailHistoryId'] as string | undefined;
  const ownerEmail = token.externalAccountEmail?.toLowerCase() ?? null;

  let ids: string[];
  let nextHistoryId: string | null;
  if (cursor) {
    const res = await historyIds(accessToken, cursor);
    if (res.expired) {
      log.warn({ tokenId: token.id }, 'Gmail history id expired (404); reseeding next tick');
      const { gmailHistoryId: _h, ...rest } = deltaState;
      await prisma.integrationToken.update({ where: { id: token.id }, data: { deltaState: rest as object } });
      return 0;
    }
    ids = res.ids;
    nextHistoryId = res.historyId ?? cursor;
  } else {
    const res = await seedIds(accessToken);
    ids = res.ids;
    nextHistoryId = res.historyId;
  }

  let persisted = 0;
  const failedIds: string[] = [];
  for (const id of ids.slice(0, MAX_MESSAGES_PER_RUN)) {
    const detail = await getJson<GmailMessageDetail>(`${API}/messages/${encodeURIComponent(id)}?format=full`, accessToken);
    if (!detail.body) continue;
    const msg = detail.body;
    if ((msg.labelIds ?? []).some((l) => SKIP_LABELS.has(l))) continue;

    try {
      const headers = msg.payload?.headers ?? [];
      const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
      const from = parseAddressList(header('From'))[0];
      const toEmails = parseAddressList(header('To'));
      const ccEmails = parseAddressList(header('Cc'));
      const fromEmail = from?.email ?? '';
      const isOutbound = Boolean(ownerEmail) && fromEmail === ownerEmail;
      const at = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();
      const target = await resolveCaptureTarget({
        orgId: token.orgId,
        ownerEmail,
        participants: [fromEmail, ...toEmails.map((a) => a.email), ...ccEmails.map((a) => a.email)],
      });
      // Mail that matches no CRM record stays out of Polo (pay slips, HR, personal mail).
      if (!target) continue;

      const saved = await prisma.emailMessage.upsert({
        where: { orgId_externalMessageId: { orgId: token.orgId, externalMessageId: msg.id } },
        create: {
          orgId: token.orgId,
          userId: token.userId,
          integrationTokenId: token.id,
          provider: EmailProvider.GMAIL,
          externalMessageId: msg.id,
          threadId: msg.threadId ?? null,
          fromEmail,
          toEmails,
          ccEmails,
          subject: header('Subject'),
          bodyText: findBody(msg.payload, 'text/plain'),
          bodyHtml: findBody(msg.payload, 'text/html'),
          receivedAt: isOutbound ? null : at,
          sentAt: isOutbound ? at : null,
          isOutbound,
          entityType: target.entityType,
          entityId: target.entityId,
          ...captureColumns(target),
        },
        update: {},
        select: { id: true },
      });
      const bridged = await bridgeActivity(
        () => syncEmailMessageActivity(token.orgId, saved.id),
        log,
        { msgId: msg.id },
      );
      persisted++;
      if (!bridged) failedIds.push(msg.id);
    } catch (err) {
      log.warn({ err, msgId: msg.id }, 'Failed to persist Gmail message');
    }
  }

  const bridge = noteActivityBridgeFailures(deltaState, `gmail:${cursor ?? 'seed'}`, failedIds);
  if (bridge.quarantined.length > 0) {
    log.warn({ tokenId: token.id, ids: bridge.quarantined }, 'Account activity bridge quarantined after repeated failures');
  }
  if (bridge.hold) {
    log.warn({ tokenId: token.id }, 'Account activity bridge failed; Gmail history cursor stays put for another attempt');
    await prisma.integrationToken.update({
      where: { id: token.id },
      data: { deltaState: deltaState as object, lastSyncedAt: new Date() },
    });
    return persisted;
  }

  await prisma.integrationToken.update({
    where: { id: token.id },
    data: {
      deltaState: { ...deltaState, ...(nextHistoryId ? { gmailHistoryId: nextHistoryId } : {}) },
      lastSyncedAt: new Date(),
    },
  });
  log.info({ tokenId: token.id, persisted }, 'Gmail pull complete');
  return persisted;
}
