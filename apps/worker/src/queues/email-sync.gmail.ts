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

import { commitTokenDeltaState } from '../lib/activity-bridge-commit.js';
import { appendBridgeObservations, bridgeActivity, captureColumns, classifyStoredBridgeId, drainPendingActivityBridges, migrateLegacyBridgePending, noteActivityBridgeFailures, resolveCaptureTarget } from '../lib/comms-capture.js';
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

/**
 * Take at most `cap` ids from one already-fetched page, remembering how far
 * into that page the next run must resume. The mailbox tip is not a cursor
 * until the page and its next page are both finished.
 */
export function consumeGmailIdPage(input: {
  messageIds: string[];
  nextPageToken: string | null;
  resumeCount: number;
  cap: number;
}): { ids: string[]; resumeCount: number; pageToken: string | null; finished: boolean } {
  const resume = Math.max(0, input.resumeCount);
  const ids = input.messageIds.slice(resume, resume + input.cap);
  const consumed = resume + ids.length;
  if (consumed < input.messageIds.length) {
    return { ids, resumeCount: consumed, pageToken: null, finished: false };
  }
  if (input.nextPageToken) {
    return { ids, resumeCount: 0, pageToken: input.nextPageToken, finished: false };
  }
  return { ids, resumeCount: 0, pageToken: null, finished: true };
}

async function seedIds(
  accessToken: string,
  resumeCount: number,
  pageToken: string | undefined,
  cap: number,
): Promise<{ ids: string[]; historyId: string | null; resumeCount: number; pageToken: string | null; finished: boolean }> {
  const profile = await getJson<{ historyId?: string }>(`${API}/profile`, accessToken);
  if (!profile.body) throw new Error(`Gmail profile failed: ${profile.status}`);
  let resume = resumeCount;
  let token = pageToken;
  const ids: string[] = [];
  for (let page = 0; page < MAX_LIST_PAGES && ids.length < cap; page++) {
    const requestedToken = token;
    const params = new URLSearchParams({ q: 'newer_than:30d', maxResults: '100' });
    if (token) params.set('pageToken', token);
    const list = await getJson<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      `${API}/messages?${params.toString()}`,
      accessToken,
    );
    if (!list.body) throw new Error(`Gmail list failed: ${list.status}`);
    const slice = consumeGmailIdPage({
      messageIds: (list.body.messages ?? []).map((m) => m.id),
      nextPageToken: list.body.nextPageToken ?? null,
      resumeCount: resume,
      cap: cap - ids.length,
    });
    ids.push(...slice.ids);
    resume = slice.resumeCount;
    if (!slice.finished && slice.pageToken === null && slice.resumeCount > 0) {
      // The page was only partly stored. The next run must request this same
      // page token again and skip `resume` ids. The token is not the next page.
      return {
        ids,
        historyId: profile.body.historyId ?? null,
        resumeCount: resume,
        pageToken: requestedToken ?? null,
        finished: false,
      };
    }
    token = slice.pageToken ?? undefined;
    if (slice.finished) {
      return { ids, historyId: profile.body.historyId ?? null, resumeCount: 0, pageToken: null, finished: true };
    }
  }
  return { ids, historyId: profile.body.historyId ?? null, resumeCount: resume, pageToken: token ?? null, finished: false };
}

async function historyIds(
  accessToken: string,
  startHistoryId: string,
  resumeCount: number,
  pageToken: string | undefined,
  cap: number,
): Promise<{
  ids: string[];
  expired: boolean;
  resumeCount: number;
  pageToken: string | null;
  finished: boolean;
  mailboxHistoryId: string | null;
}> {
  let resume = resumeCount;
  let token = pageToken;
  let mailboxHistoryId: string | null = null;
  const ids: string[] = [];
  for (let page = 0; page < MAX_LIST_PAGES * 4 && ids.length < cap; page++) {
    const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', maxResults: '500' });
    if (token) params.set('pageToken', token);
    const res = await getJson<{
      history?: Array<{ id?: string; messagesAdded?: Array<{ message: { id: string } }> }>;
      historyId?: string;
      nextPageToken?: string;
    }>(`${API}/history?${params.toString()}`, accessToken);
    if (res.status === 404) {
      return { ids: [], expired: true, resumeCount: 0, pageToken: null, finished: false, mailboxHistoryId: null };
    }
    if (!res.body) throw new Error(`Gmail history failed: ${res.status}`);
    mailboxHistoryId = res.body.historyId ?? mailboxHistoryId;
    const messageIds = (res.body.history ?? []).flatMap((h) => (h.messagesAdded ?? []).map((m) => m.message.id));
    const slice = consumeGmailIdPage({
      messageIds,
      nextPageToken: res.body.nextPageToken ?? null,
      resumeCount: resume,
      cap: cap - ids.length,
    });
    ids.push(...slice.ids);
    resume = slice.resumeCount;
    if (!slice.finished && slice.pageToken === null) {
      return { ids, expired: false, resumeCount: resume, pageToken: token ?? null, finished: false, mailboxHistoryId };
    }
    if (slice.finished) {
      return { ids, expired: false, resumeCount: 0, pageToken: null, finished: true, mailboxHistoryId };
    }
    token = slice.pageToken ?? undefined;
    resume = 0;
  }
  return { ids, expired: false, resumeCount: resume, pageToken: token ?? null, finished: false, mailboxHistoryId };
}

/** Pull new Gmail messages for one grant. Returns how many were stored. */
export async function pullGmail(
  token: GmailTokenRow,
  accessToken: string,
  log: pino.Logger,
  cap = MAX_MESSAGES_PER_RUN,
): Promise<number> {
  const deltaState = structuredClone((token.deltaState ?? {}) as Record<string, unknown>);
  const baseline = structuredClone(deltaState);
  const cursor = deltaState['gmailHistoryId'] as string | undefined;
  const ownerEmail = token.externalAccountEmail?.toLowerCase() ?? null;

  let ids: string[];
  let checkpoint: Record<string, unknown>;
  if (cursor) {
    const res = await historyIds(
      accessToken,
      cursor,
      Number(deltaState['gmailHistoryResumeCount'] ?? 0),
      typeof deltaState['gmailHistoryPageToken'] === 'string' ? deltaState['gmailHistoryPageToken'] : undefined,
      cap,
    );
    if (res.expired) {
      log.warn({ tokenId: token.id }, 'Gmail history id expired (404); reseeding next tick');
      const {
        gmailHistoryId: _h,
        gmailHistoryPageToken: _p,
        gmailHistoryResumeCount: _r,
        ...rest
      } = deltaState;
      await commitTokenDeltaState(prisma, token.id, baseline, rest, []);
      return 0;
    }
    ids = res.ids;
    checkpoint = res.finished
      ? { gmailHistoryId: res.mailboxHistoryId ?? cursor }
      : {
          gmailHistoryId: cursor,
          ...(res.pageToken ? { gmailHistoryPageToken: res.pageToken } : {}),
          ...(res.resumeCount > 0 ? { gmailHistoryResumeCount: res.resumeCount } : {}),
        };
  } else {
    const res = await seedIds(
      accessToken,
      Number(deltaState['gmailListResumeCount'] ?? 0),
      typeof deltaState['gmailListPageToken'] === 'string' ? deltaState['gmailListPageToken'] : undefined,
      cap,
    );
    ids = res.ids;
    const seedHistory = (deltaState['gmailSeedHistoryId'] as string | undefined) ?? res.historyId;
    checkpoint = res.finished
      ? { ...(seedHistory ? { gmailHistoryId: seedHistory } : {}) }
      : {
          ...(seedHistory ? { gmailSeedHistoryId: seedHistory } : {}),
          ...(res.pageToken ? { gmailListPageToken: res.pageToken } : {}),
          ...(res.resumeCount > 0 ? { gmailListResumeCount: res.resumeCount } : {}),
        };
  }

  let persisted = 0;
  const failedIds: string[] = [];
  const captureHeldIds: string[] = [];
  const settledIds: string[] = [];
  const bridgeDeltas: Parameters<typeof appendBridgeObservations>[0] = [];
  await migrateLegacyBridgePending(deltaState, (id) =>
    classifyStoredBridgeId(prisma, { orgId: token.orgId, ownerId: token.userId }, id),
  );
  for (const id of ids) {
    const detail = await getJson<GmailMessageDetail>(`${API}/messages/${encodeURIComponent(id)}?format=full`, accessToken);
    if (!detail.body) {
      // A missing body is not a reason to move the cursor past this id.
      // 404 means Gmail already dropped it. Any other status failed before a
      // row existed, so it holds the cursor and does not spend the bridge budget.
      if (detail.status !== 404) captureHeldIds.push(id);
      else settledIds.push(id);
      continue;
    }
    const msg = detail.body;
    if ((msg.labelIds ?? []).some((l) => SKIP_LABELS.has(l))) {
      settledIds.push(msg.id);
      continue;
    }

    let captured = false;
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
      if (!target) {
        settledIds.push(msg.id);
        continue;
      }

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
      captured = true;
      const bridged = await bridgeActivity(
        () => syncEmailMessageActivity(token.orgId, saved.id),
        log,
        { msgId: msg.id },
      );
      persisted++;
      if (!bridged) failedIds.push(msg.id);
      else settledIds.push(msg.id);
    } catch (err) {
      // The bridge budget is only for a row that was stored. A target lookup
      // or insert that threw has nothing for the drain to find.
      if (captured) failedIds.push(msg.id);
      else captureHeldIds.push(msg.id);
      log.warn({ err, msgId: msg.id }, 'Failed to persist Gmail message');
    }
  }

  const pageKey = `gmail:${cursor ?? 'seed'}`;
  const bridge = noteActivityBridgeFailures(deltaState, pageKey, failedIds, new Date().toISOString(), settledIds, true, undefined, 'email');
  const drained = typeof prisma.emailMessage?.findFirst === 'function'
    ? await drainPendingActivityBridges(deltaState, async (providerId) => {
    const row = await prisma.emailMessage.findFirst({
      where: { orgId: token.orgId, userId: token.userId, externalMessageId: providerId, deletedAt: null },
      select: { id: true },
    });
    // Only ids that already used the bridge budget are drained. No row means
    // that saved message is gone, so the activity bridge cannot run.
    if (!row) return 'gone';
    const ok = await bridgeActivity(() => syncEmailMessageActivity(token.orgId, row.id), log, { msgId: providerId });
    return ok;
  }, new Date().toISOString(), 'email')
    : null;
  appendBridgeObservations(bridgeDeltas, pageKey, failedIds, settledIds, drained, 'email');
  if (bridge.quarantined.length > 0) {
    log.warn({ tokenId: token.id, ids: bridge.quarantined }, 'Account activity bridge quarantined after repeated failures');
  }
  if (captureHeldIds.length > 0 || bridge.backpressure || (drained?.hold ?? bridge.hold)) {
    log.warn({ tokenId: token.id }, 'Account activity bridge failed; Gmail history cursor stays put for another attempt');
    await commitTokenDeltaState(prisma, token.id, baseline, deltaState, bridgeDeltas);
    return persisted;
  }

  const {
    gmailHistoryPageToken: _hp,
    gmailHistoryResumeCount: _hr,
    gmailListPageToken: _lp,
    gmailListResumeCount: _lr,
    gmailSeedHistoryId: _sh,
    ...cursorBase
  } = deltaState;
  await commitTokenDeltaState(prisma, token.id, baseline, { ...cursorBase, ...checkpoint }, bridgeDeltas);
  log.info({ tokenId: token.id, persisted }, 'Gmail pull complete');
  return persisted;
}
