import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const ACME = '00000000-0000-4000-8000-000000000003';
const LINK = '00000000-0000-4000-8000-000000000004';
const TOKEN = '00000000-0000-4000-8000-000000000005';
const G = 'https://graph.microsoft.com/';

const db = vi.hoisted(() => ({
  integrationToken: { findFirst: vi.fn() },
  teamsChatLink: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  company: { findFirst: vi.fn(), findMany: vi.fn() },
  opportunity: { findFirst: vi.fn() },
}));

vi.mock('@bidstack/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@bidstack/db')>();
  return {
    ...real,
    prisma: db,
    fileTeamsMessages: vi.fn(),
    filedTeamsMessageIds: vi.fn(async () => new Set<string>()),
    suggestTeamsAccounts: vi.fn(async () => []),
  };
});

vi.mock('../../services/email-integration.helpers.js', () => ({
  getAccessToken: vi.fn(async () => 'graph-access-token'),
}));

vi.mock('../../lib/access-scope.js', () => ({
  getAccessScope: vi.fn(async () => ({ unrestricted: false, userId: USER, countries: [], companyIds: [ACME] })),
  applyCompanyScope: (where: Record<string, unknown>) => ({ AND: [where, { id: { in: [ACME] } }] }),
  applyOpportunityScope: (where: unknown) => where,
}));

import {
  fileTeamsMessages,
  filedTeamsMessageIds,
  onAccountActivityCreated,
  subscribeAccountActivityDigest,
  suggestTeamsAccounts,
  type AccountActivityDigest,
} from '@bidstack/db';

import { teamsConnectScopes } from '../../services/teams-import.service.js';
import { teamsImportRoutes } from './teams.js';

const CHAT_ID = '19:acme@thread.v2';
const CHAT = {
  id: CHAT_ID,
  topic: null,
  chatType: 'group',
  webUrl: 'https://teams.microsoft.com/l/chat/19%3Aacme/0',
  lastMessagePreview: { createdDateTime: '2026-11-07T15:00:00Z' },
  members: [
    { userId: 'aad-tony', email: 'tony@mantu.com', displayName: 'Tony' },
    { userId: 'aad-jane', email: 'jane@acme.com', displayName: 'Jane Doe' },
  ],
};
const MESSAGES = {
  value: [
    {
      id: 'm2',
      messageType: 'message',
      createdDateTime: '2026-11-07T15:00:00Z',
      lastModifiedDateTime: '2026-11-07T15:05:00Z',
      from: { user: { id: 'aad-jane', displayName: 'Jane Doe' } },
      body: { contentType: 'html', content: '<p>Scope looks good</p>' },
      attachments: [{ name: 'Scope.docx', contentType: 'reference' }],
      webUrl: 'https://teams.microsoft.com/l/message/19%3Aacme/m2',
    },
    {
      id: 'sys',
      messageType: 'systemEventMessage',
      createdDateTime: '2026-11-07T14:30:00Z',
      lastModifiedDateTime: '2026-11-07T14:30:00Z',
      body: { contentType: 'html', content: '' },
    },
    {
      id: 'm1',
      messageType: 'message',
      createdDateTime: '2026-11-07T14:00:00Z',
      lastModifiedDateTime: '2026-11-07T14:00:00Z',
      from: { user: { id: 'aad-tony', displayName: 'Tony' } },
      body: { contentType: 'html', content: 'Sending the scope' },
    },
  ],
};

let graphStatus = 200;
const graphCalls: Array<{ url: string; method: string }> = [];

function grant(scope: string[], status = 'active') {
  return {
    id: TOKEN,
    orgId: ORG,
    status,
    scope,
    accessTokenEncrypted: 'enc',
    refreshTokenEncrypted: 'enc',
    expiresAt: new Date(Date.now() + 3600_000),
    externalAccountEmail: 'tony@mantu.com',
  };
}
const READY = grant([`${G}Mail.Read`, `${G}Calendars.Read`, `${G}Chat.Read`]);
const NO_TEAMS = grant([`${G}Mail.Read`, `${G}Calendars.Read`]);

let app: FastifyInstance;

beforeAll(async () => {
  process.env.MICROSOFT_GRAPH_CLIENT_ID = 'test-client-id';
  process.env.MICROSOFT_GRAPH_CLIENT_SECRET = 'test-client-value';
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    graphCalls.push({ url, method: init?.method ?? 'GET' });
    if (graphStatus !== 200) return new Response('{}', { status: graphStatus });
    const body = url.includes('/messages') ? MESSAGES : url.includes('/me/chats') ? { value: [CHAT] } : CHAT;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  app.addHook('onRequest', async (req) => {
    (req as unknown as { auth: unknown }).auth = { orgId: ORG, userId: USER };
  });
  await app.register(teamsImportRoutes, { prefix: '/api/v1' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  graphStatus = 200;
  graphCalls.length = 0;
  db.integrationToken.findFirst.mockResolvedValue(READY);
  db.teamsChatLink.findMany.mockResolvedValue([]);
  db.teamsChatLink.findFirst.mockResolvedValue(null);
  db.teamsChatLink.updateMany.mockResolvedValue({ count: 1 });
  db.teamsChatLink.create.mockResolvedValue({ id: LINK });
  db.company.findFirst.mockResolvedValue({ id: ACME });
  db.company.findMany.mockResolvedValue([{ id: ACME, name: 'Acme' }]);
  vi.mocked(fileTeamsMessages).mockResolvedValue({
    created: 1,
    updated: 0,
    skipped: 0,
    alreadyFiled: 0,
    removed: 0,
    activityIds: ['a1'],
    watermark: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.MICROSOFT_TEAMS_CHANNELS_ADMIN_CONSENTED;
});

describe('GET /integrations/teams/access', () => {
  it('reports not connected, needs consent and ready from the stored grant', async () => {
    db.integrationToken.findFirst.mockResolvedValueOnce(null);
    expect((await app.inject({ url: '/api/v1/integrations/teams/access' })).json()).toMatchObject({
      state: 'not_connected',
    });
    db.integrationToken.findFirst.mockResolvedValueOnce(NO_TEAMS);
    expect((await app.inject({ url: '/api/v1/integrations/teams/access' })).json()).toMatchObject({
      state: 'needs_consent',
      channels: 'needs_admin_consent',
    });
    expect((await app.inject({ url: '/api/v1/integrations/teams/access' })).json()).toMatchObject({
      state: 'ready',
      accountEmail: 'tony@mantu.com',
    });
  });
});

describe('consent', () => {
  it('asks to reconnect when the grant lacks Chat.Read, without calling Graph', async () => {
    db.integrationToken.findFirst.mockResolvedValue(NO_TEAMS);
    const res = await app.inject({ url: '/api/v1/integrations/teams/chats' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'teams_consent_required' });
    expect(res.json().message).toMatch(/Reconnect Microsoft 365/);
    expect(graphCalls).toHaveLength(0);
  });

  it('turns a Graph 403 into the same reconnect prompt, never an empty list', async () => {
    graphStatus = 403;
    const res = await app.inject({ url: '/api/v1/integrations/teams/chats' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'teams_consent_required' });
  });

  it('says channels need admin approval when the server is not set up for it', async () => {
    const res = await app.inject({ url: '/api/v1/integrations/teams/teams' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'teams_channels_not_approved' });
  });

  it('requests read-only Teams scopes, channel reads only when admin approved', () => {
    expect(teamsConnectScopes()).toEqual([`${G}Chat.Read`]);
    process.env.MICROSOFT_TEAMS_CHANNELS_ADMIN_CONSENTED = 'true';
    expect(teamsConnectScopes()).toContain(`${G}ChannelMessage.Read.All`);
    expect(teamsConnectScopes().join(' ')).not.toMatch(/Send|ReadWrite|Create/);
  });
});

describe('GET /integrations/teams/chats and /messages', () => {
  it('lists recent chats with a title from the other members, read-only', async () => {
    const res = await app.inject({ url: '/api/v1/integrations/teams/chats' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ title: 'Chat with Jane Doe', memberCount: 2, syncLinkId: null });
    expect(graphCalls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('shows real messages oldest first, marks filed ones and passes the access scope to suggestions', async () => {
    vi.mocked(filedTeamsMessageIds).mockResolvedValueOnce(new Set(['m1']));
    vi.mocked(suggestTeamsAccounts).mockResolvedValueOnce([
      { companyId: ACME, name: 'Acme', reason: 'contact', match: 'jane@acme.com' },
    ]);
    const res = await app.inject({
      url: `/api/v1/integrations/teams/messages?kind=chat&chatId=${encodeURIComponent(CHAT_ID)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2']);
    expect(body.items[0].filed).toBe(true);
    expect(body.items[1]).toMatchObject({ preview: 'Scope looks good', attachmentNames: ['Scope.docx'] });
    expect(body.suggestions[0].name).toBe('Acme');
    expect(vi.mocked(suggestTeamsAccounts).mock.calls[0]![0]).toMatchObject({
      emails: ['tony@mantu.com', 'jane@acme.com'],
      companyWhere: { AND: [{ orgId: ORG, deletedAt: null }, { id: { in: [ACME] } }] },
    });
  });

  it('rejects an incomplete channel thread reference', async () => {
    const res = await app.inject({ url: '/api/v1/integrations/teams/messages?kind=channel_thread&teamId=t' });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /integrations/teams/import', () => {
  const body = { ref: { kind: 'chat', chatId: CHAT_ID }, companyId: ACME, messageIds: ['m2'] };

  it('refuses an account outside the caller access scope before reading Teams', async () => {
    db.company.findFirst.mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/teams/import', payload: body });
    expect(res.statusCode).toBe(404);
    expect(graphCalls).toHaveLength(0);
    expect(fileTeamsMessages).not.toHaveBeenCalled();
  });

  it('files only the picked messages as the caller, in one alert digest per account', async () => {
    vi.mocked(fileTeamsMessages).mockImplementationOnce(async (input) => {
      await onAccountActivityCreated(input.orgId, input.companyId, 'a1', input.actorUserId, [USER]);
      await onAccountActivityCreated(input.orgId, input.companyId, 'a2', input.actorUserId, [USER]);
      return { created: 2, updated: 0, skipped: 0, alreadyFiled: 0, removed: 0, activityIds: ['a1', 'a2'], watermark: null };
    });
    const digests: AccountActivityDigest[] = [];
    const off = subscribeAccountActivityDigest((d) => {
      digests.push(d);
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/teams/import',
        payload: { ...body, messageIds: ['m2', 'missing'] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ created: 2, skipped: 1, syncLinkId: null });
    } finally {
      off();
    }
    const input = vi.mocked(fileTeamsMessages).mock.calls[0]![0];
    expect(input.messages.map((m) => m.id)).toEqual(['m2']);
    expect(input).toMatchObject({ actorUserId: USER, ownerUserId: USER, companyId: ACME });
    expect(input.thread.members.map((m) => m.email)).toEqual(['tony@mantu.com', 'jane@acme.com']);
    expect(digests).toHaveLength(1);
    expect(digests[0]!.activityIds).toEqual(['a1', 'a2']);
    expect(db.teamsChatLink.create).not.toHaveBeenCalled();
  });

  it('links the chat for ongoing sync from the newest message it read', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/teams/import',
      payload: { ...body, keepSyncing: true },
    });
    expect(res.json()).toMatchObject({ syncLinkId: LINK });
    expect(db.teamsChatLink.create.mock.calls[0]![0].data).toMatchObject({
      orgId: ORG,
      userId: USER,
      integrationTokenId: TOKEN,
      threadKey: `chat:${CHAT_ID}`,
      kind: 'chat',
      companyId: ACME,
      keepSyncing: true,
      watermark: new Date('2026-11-07T15:05:00Z'),
    });
  });

  it('needs a message or sync', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/teams/import',
      payload: { ...body, messageIds: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('sync links', () => {
  it('only changes the caller own link', async () => {
    db.teamsChatLink.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/integrations/teams/links/${LINK}`,
      payload: { keepSyncing: false },
    });
    expect(res.statusCode).toBe(404);
    expect(db.teamsChatLink.updateMany.mock.calls[0]![0].where).toMatchObject({ id: LINK, orgId: ORG, userId: USER });
  });

  it('lists synced chats on accounts the caller can see', async () => {
    db.teamsChatLink.findMany.mockResolvedValueOnce([
      {
        id: LINK,
        kind: 'chat',
        chatId: CHAT_ID,
        teamId: null,
        channelId: null,
        rootMessageId: null,
        title: 'Chat with Jane Doe',
        companyId: ACME,
        keepSyncing: true,
        lastSyncedAt: null,
        lastError: 'consent_required',
      },
    ]);
    const res = await app.inject({ url: `/api/v1/integrations/teams/links?companyId=${ACME}` });
    expect(res.json().items[0]).toMatchObject({ companyName: 'Acme', lastError: 'consent_required' });
  });
});
