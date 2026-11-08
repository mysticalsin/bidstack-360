import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import {
  onAccountActivityCreated,
  subscribeAccountActivityDigest,
  type AccountActivityDigest,
  type FileTeamsMessagesInput,
} from '@bidstack/db';

import { ProviderRateLimitError } from '../lib/provider-http.js';
import { syncTeamsLinksForToken, type TeamsSyncDeps } from './teams-chat-sync.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const TOKEN = '00000000-0000-4000-8000-000000000003';
const ACME = '00000000-0000-4000-8000-000000000004';
const G = 'https://graph.microsoft.com/';
const log = pino({ level: 'silent' });

const CHAT = {
  id: 'chat-1',
  topic: 'Acme RFP',
  chatType: 'group',
  members: [
    { userId: 'aad-tony', email: 'tony@mantu.com', displayName: 'Tony' },
    { userId: 'aad-jane', email: 'jane@acme.com', displayName: 'Jane' },
  ],
};
const NEW_MESSAGES = {
  value: [
    {
      id: 'm3',
      messageType: 'message',
      createdDateTime: '2026-11-08T10:00:00Z',
      lastModifiedDateTime: '2026-11-08T10:00:00Z',
      from: { user: { id: 'aad-jane', displayName: 'Jane' } },
      body: { contentType: 'html', content: 'New pricing attached' },
    },
    {
      id: 'm2',
      messageType: 'message',
      createdDateTime: '2026-11-08T09:00:00Z',
      lastModifiedDateTime: '2026-11-08T09:30:00Z',
      from: { user: { id: 'aad-tony', displayName: 'Tony' } },
      body: { contentType: 'html', content: 'Thanks' },
    },
  ],
};

function link(over: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    orgId: ORG,
    userId: USER,
    integrationTokenId: TOKEN,
    kind: 'chat',
    chatId: 'chat-1',
    teamId: null,
    channelId: null,
    rootMessageId: null,
    companyId: ACME,
    opportunityId: null,
    keepSyncing: true,
    watermark: new Date('2026-11-08T08:00:00Z'),
    lastSyncedAt: null,
    ...over,
  };
}

function setup(opts: { scope?: string[]; links?: ReturnType<typeof link>[]; graph?: (url: string) => Response } = {}) {
  const calls: string[] = [];
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (opts.graph) return opts.graph(url);
    const body = url.includes('/messages') ? NEW_MESSAGES : CHAT;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const db = {
    integrationToken: {
      findFirst: vi.fn(async () => ({
        id: TOKEN,
        orgId: ORG,
        provider: 'microsoft_graph',
        status: 'active',
        scope: opts.scope ?? [`${G}Mail.Read`, `${G}Chat.Read`],
        accessTokenEncrypted: 'enc',
        refreshTokenEncrypted: null,
        expiresAt: null,
        externalAccountEmail: 'Tony@mantu.com',
      })),
    },
    teamsChatLink: {
      findMany: vi.fn(async () => opts.links ?? [link()]),
      updateMany: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push(args);
        return { count: 1 };
      }),
    },
    company: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === ACME ? { id: ACME } : null)) },
  };
  const file = vi.fn(async (input: FileTeamsMessagesInput) => {
    for (const m of input.messages) await onAccountActivityCreated(input.orgId, input.companyId, `act-${m.id}`, null, [USER]);
    return {
      created: input.messages.length,
      updated: 0,
      skipped: 0,
      alreadyFiled: 0,
      removed: 0,
      activityIds: input.messages.map((m) => `act-${m.id}`),
      watermark: new Date('2026-11-08T10:00:00Z'),
    };
  });
  const deps = {
    db: db as unknown as TeamsSyncDeps['db'],
    getToken: vi.fn(async () => 'graph-access-token'),
    file: file as unknown as TeamsSyncDeps['file'],
    fetchImpl,
  } satisfies TeamsSyncDeps;
  return { deps, db, calls, updates, file };
}

const job = { orgId: ORG, userId: USER, integrationTokenId: TOKEN };

describe('syncTeamsLinksForToken', () => {
  it('files messages changed since the watermark as the system, in one digest per account', async () => {
    const { deps, calls, updates, file } = setup();
    const digests: AccountActivityDigest[] = [];
    const off = subscribeAccountActivityDigest((d) => {
      digests.push(d);
    });
    try {
      const summary = await syncTeamsLinksForToken(job, log, deps);
      expect(summary).toEqual({ links: 1, created: 2, failed: 0 });
    } finally {
      off();
    }
    const messagesCall = decodeURIComponent(calls.find((c) => c.includes('/messages'))!);
    expect(messagesCall).toContain('lastModifiedDateTime gt 2026-11-08T08:00:00.000Z');
    const input = file.mock.calls[0]![0];
    expect(input).toMatchObject({ actorUserId: null, ownerUserId: USER, ownerEmail: 'tony@mantu.com', companyId: ACME });
    expect(input.thread.title).toBe('Acme RFP');
    expect(input.messages.map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(digests).toHaveLength(1);
    expect(digests[0]!.activityIds).toEqual(['act-m2', 'act-m3']);
    expect(updates[0]!.data).toMatchObject({ watermark: new Date('2026-11-08T10:00:00Z'), lastError: null });
  });

  it('marks links for reconnect when the grant lacks Chat.Read, without calling Graph', async () => {
    const { deps, calls, updates, file } = setup({ scope: [`${G}Mail.Read`] });
    const summary = await syncTeamsLinksForToken(job, log, deps);
    expect(summary.failed).toBe(1);
    expect(calls).toHaveLength(0);
    expect(file).not.toHaveBeenCalled();
    expect(updates[0]!.data).toMatchObject({ lastError: 'consent_required' });
  });

  it('records a Graph 403 on the link and moves on to the next one', async () => {
    const { deps, updates } = setup({
      links: [link(), link({ id: 'link-2', chatId: 'chat-2' })],
      graph: (url) =>
        url.includes('chat-1')
          ? new Response('{}', { status: 403 })
          : new Response(JSON.stringify(url.includes('/messages') ? NEW_MESSAGES : CHAT), { status: 200 }),
    });
    const summary = await syncTeamsLinksForToken(job, log, deps);
    expect(summary).toMatchObject({ links: 2, failed: 1, created: 2 });
    expect(updates.find((u) => u.where.id === 'link-1')!.data).toMatchObject({ lastError: 'consent_required' });
    expect(updates.find((u) => u.where.id === 'link-2')!.data).toMatchObject({ lastError: null });
  });

  it('turns Graph throttling into a delayed job', async () => {
    const { deps } = setup({ graph: () => new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }) });
    const err = await syncTeamsLinksForToken(job, log, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect((err as ProviderRateLimitError).retryAfterMs).toBe(30_000);
  });

  it('needs channel read consent for a channel thread link', async () => {
    const { deps, updates, calls } = setup({
      links: [link({ kind: 'channel_thread', chatId: null, teamId: 't', channelId: 'c', rootMessageId: 'r' })],
    });
    await syncTeamsLinksForToken(job, log, deps);
    expect(calls).toHaveLength(0);
    expect(updates[0]!.data).toMatchObject({ lastError: 'consent_required' });
  });

  it('stops filing to an account that was deleted', async () => {
    const { deps, updates, file } = setup({ links: [link({ companyId: '00000000-0000-4000-8000-0000000000ff' })] });
    await syncTeamsLinksForToken(job, log, deps);
    expect(file).not.toHaveBeenCalled();
    expect(updates[0]!.data).toMatchObject({ lastError: 'account_missing' });
  });

  it('only ever sends GET requests to Graph', async () => {
    const methods: string[] = [];
    const { deps } = setup();
    const inner = deps.fetchImpl;
    deps.fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return inner(input, init);
    }) as typeof fetch;
    await syncTeamsLinksForToken(job, log, deps);
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });
});
