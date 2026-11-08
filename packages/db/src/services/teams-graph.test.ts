import { describe, expect, it } from 'vitest';

import {
  TeamsConsentError,
  TeamsNotFoundError,
  TeamsThrottledError,
  createTeamsGraphClient,
  teamsPlainText,
} from './teams-graph.js';

const G = 'https://graph.microsoft.com/v1.0';

/** Graph fixtures recorded from the documented v1.0 response shapes. */
const CHATS = {
  value: [
    {
      id: '19:acme-chat@thread.v2',
      topic: null,
      chatType: 'group',
      webUrl: 'https://teams.microsoft.com/l/chat/19%3Aacme-chat%40thread.v2/0',
      lastUpdatedDateTime: '2026-11-07T10:00:00Z',
      lastMessagePreview: { createdDateTime: '2026-11-07T15:00:00Z' },
      members: [
        { userId: 'aad-tony', email: 'Tony@Mantu.com', displayName: 'Tony' },
        { userId: 'aad-jane', email: 'jane@acme.com', displayName: 'Jane Doe' },
      ],
    },
  ],
};

const MESSAGES_PAGE_1 = {
  value: [
    {
      id: '1730991600000',
      messageType: 'message',
      createdDateTime: '2026-11-07T15:00:00Z',
      lastModifiedDateTime: '2026-11-07T15:00:00Z',
      deletedDateTime: null,
      webUrl: 'https://teams.microsoft.com/l/message/19%3Aacme-chat%40thread.v2/1730991600000',
      from: { user: { id: 'aad-jane', displayName: 'Jane Doe' } },
      body: {
        contentType: 'html',
        content: '<p>Can we review the <b>RFP</b> scope&nbsp;Friday?</p><attachment id="a1"></attachment>',
      },
      attachments: [{ name: 'Scope v2.docx', contentType: 'reference' }],
    },
  ],
  '@odata.nextLink': `${G}/chats/19%3Aacme-chat%40thread.v2/messages?$skiptoken=abc`,
};

const MESSAGES_PAGE_2 = {
  value: [
    {
      id: '1730988000000',
      messageType: 'systemEventMessage',
      createdDateTime: '2026-11-07T14:00:00Z',
      lastModifiedDateTime: '2026-11-07T14:00:00Z',
      from: null,
      body: { contentType: 'html', content: '<systemEventMessage/>' },
      attachments: [],
    },
  ],
};

type Call = { url: string; method: string; auth: string | null };

function fakeFetch(routes: Record<string, { status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', auth: headers.get('Authorization') });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const route = key ? routes[key]! : { status: 404, body: {} };
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(route.headers ?? {}) },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe('teamsPlainText', () => {
  it('strips tags and decodes the common entities', () => {
    expect(teamsPlainText('<p>Hi&nbsp;<b>team</b> &amp; Acme</p><p>Line two</p>')).toBe('Hi team & Acme\nLine two');
  });

  it('drops script and style content', () => {
    expect(teamsPlainText('<style>p{}</style><script>alert(1)</script>ok')).toBe('ok');
  });

  it('keeps plain text bodies as they are', () => {
    expect(teamsPlainText('a <b> literal', 'text')).toBe('a <b> literal');
  });
});

describe('Teams Graph client', () => {
  it('lists chats with members, read-only, with the bearer token', async () => {
    const { impl, calls } = fakeFetch({ [`${G}/me/chats`]: { body: CHATS } });
    const chats = await createTeamsGraphClient('tok', impl).listChats();
    expect(chats).toHaveLength(1);
    expect(chats[0]!.members[0]!.email).toBe('tony@mantu.com');
    expect(chats[0]!.lastActivityAt).toBe('2026-11-07T15:00:00Z');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls[0]!.auth).toBe('Bearer tok');
    expect(calls[0]!.url).toContain('%24expand=members');
  });

  it('pages chat messages, keeps attachment names only, strips HTML', async () => {
    const { impl, calls } = fakeFetch({
      [`${G}/chats/19%3Aacme-chat%40thread.v2/messages?$skiptoken`]: { body: MESSAGES_PAGE_2 },
      [`${G}/chats/19%3Aacme-chat%40thread.v2/messages`]: { body: MESSAGES_PAGE_1 },
    });
    const since = new Date('2026-11-01T00:00:00Z');
    const msgs = await createTeamsGraphClient('tok', impl).listChatMessages('19:acme-chat@thread.v2', { since });
    expect(msgs.map((m) => m.messageType)).toEqual(['message', 'systemEventMessage']);
    expect(msgs[0]!.text).toBe('Can we review the RFP scope Friday?');
    expect(msgs[0]!.attachmentNames).toEqual(['Scope v2.docx']);
    expect(msgs[0]!.authorAadId).toBe('aad-jane');
    expect(decodeURIComponent(calls[0]!.url)).toContain('lastModifiedDateTime gt 2026-11-01T00:00:00.000Z');
    expect(calls).toHaveLength(2);
  });

  it('never follows a nextLink off the Graph origin', async () => {
    const { impl, calls } = fakeFetch({
      [`${G}/chats/x/messages`]: { body: { value: [], '@odata.nextLink': 'https://evil.example/steal' } },
    });
    await createTeamsGraphClient('tok', impl).listChatMessages('x');
    expect(calls).toHaveLength(1);
  });

  it('maps 403 to a consent error so callers can ask to reconnect', async () => {
    const { impl } = fakeFetch({ [`${G}/me/chats`]: { status: 403, body: { error: { code: 'Forbidden' } } } });
    await expect(createTeamsGraphClient('tok', impl).listChats()).rejects.toBeInstanceOf(TeamsConsentError);
  });

  it('maps 404 and 429 to typed errors', async () => {
    const { impl } = fakeFetch({
      [`${G}/chats/gone`]: { status: 404 },
      [`${G}/me/chats`]: { status: 429, headers: { 'Retry-After': '7' } },
    });
    const client = createTeamsGraphClient('tok', impl);
    await expect(client.getChat('gone')).rejects.toBeInstanceOf(TeamsNotFoundError);
    const err = await client.listChats().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamsThrottledError);
    expect((err as TeamsThrottledError).retryAfterMs).toBe(7000);
  });

  it('reads a channel thread root and replies oldest first, filtered by watermark', async () => {
    const base = `${G}/teams/t1/channels/c1/messages/root`;
    const { impl } = fakeFetch({
      [`${base}/replies`]: {
        body: {
          value: [
            { id: 'r2', createdDateTime: '2026-11-07T12:00:00Z', lastModifiedDateTime: '2026-11-07T12:00:00Z', body: { content: 'second' } },
            { id: 'r1', createdDateTime: '2026-11-07T11:00:00Z', lastModifiedDateTime: '2026-11-07T11:00:00Z', body: { content: 'first' } },
          ],
        },
      },
      [base]: { body: { id: 'root', createdDateTime: '2026-11-07T10:00:00Z', lastModifiedDateTime: '2026-11-07T10:00:00Z', body: { content: 'root' } } },
    });
    const client = createTeamsGraphClient('tok', impl);
    expect((await client.listThreadMessages('t1', 'c1', 'root')).map((m) => m.id)).toEqual(['root', 'r1', 'r2']);
    expect(
      (await client.listThreadMessages('t1', 'c1', 'root', { since: new Date('2026-11-07T11:30:00Z') })).map((m) => m.id),
    ).toEqual(['r2']);
  });
});
