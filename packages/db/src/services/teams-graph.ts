// Read-only Microsoft Graph calls for Teams chat import (slice 26).
//
// Only GET requests, only on chats and channel threads the signed-in user can
// already read: /me/chats, /chats/{id}/messages, /me/joinedTeams,
// /teams/{id}/channels and channel message replies. Nothing here posts,
// edits or reacts. Message bodies are reduced to plain text and attachments
// to their names; attachment content is never fetched.
//
// fetch is injectable so tests run on fixtures.

const GRAPH = 'https://graph.microsoft.com/v1.0';
const GRAPH_ORIGIN = 'https://graph.microsoft.com/';
const TIMEOUT_MS = 15_000;
const MAX_PAGES = 10;
const PREVIEW_MAX = 1000;

export type FetchLike = typeof fetch;

/** Graph refused for a missing permission (no Chat.Read, or channel access not approved). */
export class TeamsConsentError extends Error {
  override readonly name = 'TeamsConsentError';
}

/** The chat or thread is gone or the user left it. */
export class TeamsNotFoundError extends Error {
  override readonly name = 'TeamsNotFoundError';
}

/** Graph asked us to slow down. */
export class TeamsThrottledError extends Error {
  override readonly name = 'TeamsThrottledError';
  constructor(readonly retryAfterMs: number) {
    super(`Microsoft Graph throttled the request; retry after ${retryAfterMs}ms`);
  }
}

export class TeamsGraphError extends Error {
  override readonly name = 'TeamsGraphError';
  constructor(readonly status: number) {
    super(`Microsoft Graph returned ${status}`);
  }
}

export interface TeamsMember {
  /** Entra (AAD) user id; null for some external members. */
  aadUserId: string | null;
  email: string | null;
  displayName: string | null;
}

export interface TeamsChat {
  id: string;
  topic: string | null;
  chatType: string;
  webUrl: string | null;
  lastActivityAt: string | null;
  members: TeamsMember[];
}

export interface TeamsMessage {
  id: string;
  /** message, systemEventMessage, ... Only "message" is filed. */
  messageType: string;
  createdAt: string;
  lastModifiedAt: string;
  deletedAt: string | null;
  authorAadId: string | null;
  authorName: string | null;
  text: string;
  attachmentNames: string[];
  webUrl: string | null;
  replyToId: string | null;
}

export interface TeamsTeam {
  id: string;
  displayName: string;
}

export interface TeamsChannel {
  id: string;
  displayName: string;
}

interface GraphPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

interface RawMember {
  userId?: string | null;
  email?: string | null;
  displayName?: string | null;
}

interface RawChat {
  id: string;
  topic?: string | null;
  chatType?: string;
  webUrl?: string | null;
  lastUpdatedDateTime?: string | null;
  lastMessagePreview?: { createdDateTime?: string | null } | null;
  members?: RawMember[];
}

interface RawMessage {
  id: string;
  messageType?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string | null;
  deletedDateTime?: string | null;
  replyToId?: string | null;
  webUrl?: string | null;
  from?: { user?: { id?: string | null; displayName?: string | null } | null; application?: { displayName?: string | null } | null } | null;
  body?: { contentType?: string; content?: string | null } | null;
  attachments?: Array<{ name?: string | null; contentType?: string | null }> | null;
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/** Teams message HTML to trimmed plain text. */
export function teamsPlainText(content: string | null | undefined, contentType = 'html'): string {
  let text = content ?? '';
  if (contentType.toLowerCase() === 'html') {
    text = text
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);
  }
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, PREVIEW_MAX);
}

/** OData query string with spaces as %20, not "+". */
function query(params: URLSearchParams): string {
  return params.toString().replace(/\+/g, '%20');
}

function isGraphUrl(url: string): boolean {
  return url.startsWith(GRAPH_ORIGIN);
}

function retryAfter(header: string | null): number {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 15 * 60_000) : 30_000;
}

export function createTeamsGraphClient(accessToken: string, fetchImpl: FetchLike = fetch) {
  async function get<T>(url: string): Promise<T> {
    if (!isGraphUrl(url)) throw new TeamsGraphError(400);
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 403) throw new TeamsConsentError('Microsoft Graph refused the Teams read (403)');
    if (res.status === 404) throw new TeamsNotFoundError('Teams conversation not found');
    if (res.status === 429 || (res.status === 503 && res.headers.has('Retry-After'))) {
      throw new TeamsThrottledError(retryAfter(res.headers.get('Retry-After')));
    }
    throw new TeamsGraphError(res.status);
  }

  /** Follow nextLink pages (Graph origin only) until `stop` or the page cap. */
  async function pages<T>(first: string, stop?: (batch: T[]) => boolean): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = first;
    for (let i = 0; url && i < MAX_PAGES; i += 1) {
      const page: GraphPage<T> = await get<GraphPage<T>>(url);
      const batch = page.value ?? [];
      out.push(...batch);
      if (stop?.(batch)) break;
      const next = page['@odata.nextLink'];
      url = next && isGraphUrl(next) ? next : undefined;
    }
    return out;
  }

  const member = (m: RawMember): TeamsMember => ({
    aadUserId: m.userId ?? null,
    email: m.email ? m.email.trim().toLowerCase() : null,
    displayName: m.displayName ?? null,
  });

  const chat = (c: RawChat): TeamsChat => ({
    id: c.id,
    topic: c.topic?.trim() || null,
    chatType: c.chatType ?? 'group',
    webUrl: c.webUrl ?? null,
    lastActivityAt: c.lastMessagePreview?.createdDateTime ?? c.lastUpdatedDateTime ?? null,
    members: (c.members ?? []).map(member),
  });

  const message = (m: RawMessage): TeamsMessage => ({
    id: m.id,
    messageType: m.messageType ?? 'message',
    createdAt: m.createdDateTime ?? new Date(0).toISOString(),
    lastModifiedAt: m.lastModifiedDateTime ?? m.createdDateTime ?? new Date(0).toISOString(),
    deletedAt: m.deletedDateTime ?? null,
    authorAadId: m.from?.user?.id ?? null,
    authorName: m.from?.user?.displayName ?? m.from?.application?.displayName ?? null,
    text: teamsPlainText(m.body?.content, m.body?.contentType ?? 'html'),
    attachmentNames: (m.attachments ?? [])
      .filter((a) => a.contentType !== 'messageReference')
      .flatMap((a) => (a.name?.trim() ? [a.name.trim().slice(0, 200)] : []))
      .slice(0, 20),
    webUrl: m.webUrl ?? null,
    replyToId: m.replyToId ?? null,
  });

  return {
    /** Recent chats with their members, newest activity first. */
    async listChats(top = 50): Promise<TeamsChat[]> {
      const params = new URLSearchParams({
        $expand: 'members',
        $orderby: 'lastMessagePreview/createdDateTime desc',
        $top: String(Math.min(top, 50)),
      });
      const page = await get<GraphPage<RawChat>>(`${GRAPH}/me/chats?${query(params)}`);
      return (page.value ?? []).map(chat);
    },

    async getChat(chatId: string): Promise<TeamsChat> {
      return chat(await get<RawChat>(`${GRAPH}/chats/${encodeURIComponent(chatId)}?$expand=members`));
    },

    /**
     * Chat messages, newest change first. With `since`, only messages changed
     * after it (Graph supports $filter on lastModifiedDateTime with this order).
     */
    async listChatMessages(chatId: string, opts: { since?: Date | null; limit?: number } = {}): Promise<TeamsMessage[]> {
      const limit = opts.limit ?? 200;
      const params = new URLSearchParams({ $top: '50', $orderby: 'lastModifiedDateTime desc' });
      if (opts.since) params.set('$filter', `lastModifiedDateTime gt ${opts.since.toISOString()}`);
      let seen = 0;
      const raw = await pages<RawMessage>(
        `${GRAPH}/chats/${encodeURIComponent(chatId)}/messages?${query(params)}`,
        (batch) => (seen += batch.length) >= limit,
      );
      return raw.slice(0, limit).map(message);
    },

    async listJoinedTeams(): Promise<TeamsTeam[]> {
      const raw = await pages<{ id: string; displayName?: string | null }>(`${GRAPH}/me/joinedTeams?$select=id,displayName`);
      return raw.map((t) => ({ id: t.id, displayName: t.displayName ?? 'Team' }));
    },

    async listChannels(teamId: string): Promise<TeamsChannel[]> {
      const raw = await pages<{ id: string; displayName?: string | null }>(
        `${GRAPH}/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName`,
      );
      return raw.map((c) => ({ id: c.id, displayName: c.displayName ?? 'Channel' }));
    },

    /** Recent root posts in a channel (thread starters). */
    async listChannelThreads(teamId: string, channelId: string, top = 20): Promise<TeamsMessage[]> {
      const page = await get<GraphPage<RawMessage>>(
        `${GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=${Math.min(top, 50)}`,
      );
      return (page.value ?? []).map(message);
    },

    /** Root post plus its replies, oldest first. */
    async listThreadMessages(
      teamId: string,
      channelId: string,
      messageId: string,
      opts: { since?: Date | null } = {},
    ): Promise<TeamsMessage[]> {
      const base = `${GRAPH}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`;
      const root = message(await get<RawMessage>(base));
      const replies = (await pages<RawMessage>(`${base}/replies?$top=50`)).map(message);
      const all = [root, ...replies];
      const since = opts.since?.getTime();
      return all
        .filter((m) => since === undefined || Date.parse(m.lastModifiedAt) > since)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    },
  };
}

export type TeamsGraphClient = ReturnType<typeof createTeamsGraphClient>;
