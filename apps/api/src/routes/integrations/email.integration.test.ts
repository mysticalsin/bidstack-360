/**
 * Email capture routes: list, thread view, and drafts. Compose never sends:
 * drafts are stored in Polo only and the provider is never called.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { EmailProvider, IntegrationProvider, prisma } from '@bidstack/db';
import { encryptToken } from '@bidstack/shared/token-crypto';
import { _resetIntegrationTokenKey } from '@bidstack/shared/server-crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/fetch-timeout.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from '../../lib/fetch-timeout.js';
import { buildServer } from '../../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../../test-support/isolated-org.js';

const mockedFetch = vi.mocked(fetchWithTimeout);
const previousKey = process.env.INTEGRATION_TOKEN_KEY;
const previousRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;

let server: FastifyInstance;
let orgId = '';
let otherOrgId = '';
let userId = '';
let otherUserId = '';
let colleagueId = '';
let contactId = '';
let restoreAuth: (() => void) | null = null;

async function seedMessage(over: Partial<{ org: string; user: string; thread: string; at: string; deleted: boolean; contact: string | null; subject: string }> = {}) {
  return prisma.emailMessage.create({
    data: {
      orgId: over.org ?? orgId,
      userId: over.user ?? userId,
      integrationTokenId: randomUUID(),
      provider: EmailProvider.OUTLOOK,
      externalMessageId: `ext-${randomUUID()}`,
      threadId: over.thread ?? 'thread-1',
      fromEmail: 'buyer@acme.test',
      toEmails: [{ email: 'tony@example.test' }],
      subject: over.subject ?? 'RFP questions',
      bodyHtml: '<p>Hello</p>',
      receivedAt: new Date(over.at ?? '2026-11-06T14:00:00Z'),
      isOutbound: false,
      entityType: over.contact ? 'contact' : null,
      entityId: over.contact ?? null,
      contactId: over.contact ?? null,
      deletedAt: over.deleted ? new Date() : null,
    },
  });
}

beforeAll(async () => {
  process.env.INTEGRATION_TOKEN_KEY = randomBytes(32).toString('hex');
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  _resetIntegrationTokenKey();
  const org = await createIsolatedOrg('emailcap');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const other = await createIsolatedOrg('emailcap_other');
  otherOrgId = other.orgId;
  server = await buildServer();
  await server.ready();
  userId = (await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } }))!.id;
  otherUserId = (await prisma.user.findFirst({ where: { orgId: otherOrgId }, select: { id: true } }))!.id;
  contactId = (await prisma.contact.findFirst({ where: { orgId }, select: { id: true } }))!.id;
  colleagueId = (await prisma.user.findFirst({ where: { orgId, id: { not: userId } }, select: { id: true } }))!.id;
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
  if (otherOrgId) await dropIsolatedOrg(otherOrgId);
  if (previousKey === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
  else process.env.INTEGRATION_TOKEN_KEY = previousKey;
  if (previousRoleHeader === undefined) delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  else process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousRoleHeader;
  _resetIntegrationTokenKey();
});

beforeEach(async () => {
  mockedFetch.mockReset();
  await prisma.emailMessage.deleteMany({ where: { orgId: { in: [orgId, otherOrgId] } } });
  await prisma.emailDraft.deleteMany({ where: { orgId: { in: [orgId, otherOrgId] } } });
});

describe('GET /email/messages', () => {
  it('lists live messages for the org only, newest first', async () => {
    await seedMessage({ at: '2026-11-05T10:00:00Z', subject: 'older' });
    await seedMessage({ at: '2026-11-06T10:00:00Z', subject: 'newer' });
    await seedMessage({ deleted: true, subject: 'erased' });
    await seedMessage({ org: otherOrgId, user: otherUserId, subject: 'foreign' });
    const res = await server.inject({ method: 'GET', url: '/api/v1/email/messages' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ messages: Array<{ subject: string }>; total: number }>();
    expect(body.messages.map((m) => m.subject)).toEqual(['newer', 'older']);
    expect(body.total).toBe(2);
  });

  it('filters by the filed contact', async () => {
    await seedMessage({ contact: contactId, subject: 'filed' });
    await seedMessage({ subject: 'unfiled' });
    const res = await server.inject({ method: 'GET', url: `/api/v1/email/messages?contactId=${contactId}` });
    expect(res.json<{ messages: Array<{ subject: string }> }>().messages.map((m) => m.subject)).toEqual(['filed']);
  });

  it('hides a colleague\'s unfiled mail but shows mail filed on a CRM record', async () => {
    await seedMessage({ user: colleagueId, subject: 'colleague private' });
    await seedMessage({ user: colleagueId, contact: contactId, subject: 'colleague filed' });
    await seedMessage({ subject: 'mine' });
    const res = await server.inject({ method: 'GET', url: '/api/v1/email/messages' });
    const body = res.json<{ messages: Array<{ subject: string }>; total: number }>();
    expect(body.messages.map((m) => m.subject).sort()).toEqual(['colleague filed', 'mine']);
    expect(body.total).toBe(2);
  });

  it('rejects out-of-range pagination', async () => {
    for (const qs of ['limit=101', 'limit=0', 'page=0']) {
      const res = await server.inject({ method: 'GET', url: `/api/v1/email/messages?${qs}` });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('GET /email/threads/:threadId', () => {
  it('returns the thread oldest first with bodies', async () => {
    await seedMessage({ at: '2026-11-06T15:00:00Z', subject: 'Re: RFP questions' });
    await seedMessage({ at: '2026-11-06T14:00:00Z', subject: 'RFP questions' });
    const res = await server.inject({ method: 'GET', url: '/api/v1/email/threads/thread-1' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ messages: Array<{ subject: string; bodyHtml: string | null }> }>();
    expect(body.messages.map((m) => m.subject)).toEqual(['RFP questions', 'Re: RFP questions']);
    expect(body.messages[0]?.bodyHtml).toBe('<p>Hello</p>');
  });

  it('returns 404 for a colleague\'s unfiled thread', async () => {
    await seedMessage({ user: colleagueId, thread: 'colleague-thread' });
    const res = await server.inject({ method: 'GET', url: '/api/v1/email/threads/colleague-thread' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a thread that only exists in another org', async () => {
    await seedMessage({ org: otherOrgId, user: otherUserId, thread: 'foreign-thread' });
    const res = await server.inject({ method: 'GET', url: '/api/v1/email/threads/foreign-thread' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /email/drafts', () => {
  const body = {
    to: [{ email: 'buyer@acme.test', name: 'Buyer' }],
    subject: 'Follow up',
    text: 'Thanks for the call.',
    contactId: '',
    clientRequestId: '',
  };

  it('stores a draft and never contacts the mail provider', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/email/drafts',
      payload: { ...body, contactId, clientRequestId: randomUUID() },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ status: string }>().status).toBe('draft');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('is idempotent on retry with the same client request id', async () => {
    const clientRequestId = randomUUID();
    const first = await server.inject({ method: 'POST', url: '/api/v1/email/drafts', payload: { ...body, contactId, clientRequestId } });
    const retry = await server.inject({ method: 'POST', url: '/api/v1/email/drafts', payload: { ...body, contactId, clientRequestId } });
    expect(retry.statusCode).toBe(200);
    expect(retry.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(await prisma.emailDraft.count({ where: { orgId } })).toBe(1);
  });

  it('rejects an invalid draft', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/email/drafts',
      payload: { to: [{ email: 'not-an-email' }], subject: '', clientRequestId: randomUUID() },
    });
    expect(res.statusCode).toBe(400);
  });

  it('forbids a read-only role', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/email/drafts',
      headers: { 'x-bidstack-e2e-role': 'viewer' },
      payload: { ...body, contactId, clientRequestId: randomUUID() },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lists only this org drafts', async () => {
    await server.inject({ method: 'POST', url: '/api/v1/email/drafts', payload: { ...body, contactId, clientRequestId: randomUUID() } });
    await prisma.emailDraft.create({
      data: { orgId: otherOrgId, userId: otherUserId, toEmails: [], subject: 'foreign', clientRequestId: randomUUID() },
    });
    const res = await server.inject({ method: 'GET', url: `/api/v1/email/drafts?contactId=${contactId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: Array<{ subject: string }> }>().items.map((d) => d.subject)).toEqual(['Follow up']);
  });
});

describe('POST /email/send on a read-only grant', () => {
  it('refuses without calling the provider', async () => {
    await prisma.integrationToken.deleteMany({ where: { orgId } });
    await prisma.integrationToken.create({
      data: {
        orgId,
        userId,
        provider: IntegrationProvider.gmail,
        accessTokenEncrypted: encryptToken('a'),
        scope: ['https://www.googleapis.com/auth/gmail.readonly'],
        status: 'active',
      },
    });
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/email/send',
      payload: { to: [{ email: 'buyer@acme.test' }], subject: 'Hi', text: 'Hello' },
    });
    expect(res.statusCode).toBe(409);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
