// Inbox capture against mocked Graph and Gmail APIs: delta paging, cursor
// merge, sent-items capture, dedupe by provider message id, and filing.
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CommsCapture from '../lib/comms-capture.js';
import { resolveCaptureTarget } from '../lib/comms-capture.js';

import { prisma } from '@bidstack/db';

import { pullDelta } from './email-sync.pull.js';
import { pullGmail } from './email-sync.gmail.js';

vi.mock('@bidstack/db', () => ({
  EmailProvider: { GMAIL: 'GMAIL', OUTLOOK: 'OUTLOOK' },
  prisma: {
    integrationToken: { findFirst: vi.fn(), update: vi.fn() },
    emailMessage: { upsert: vi.fn() },
  },
}));

vi.mock('../lib/workspace-token.js', () => ({
  getWorkspaceAccessToken: vi.fn(async () => 'access-token'),
}));

vi.mock('../lib/comms-capture.js', async (importOriginal) => ({
  ...(await importOriginal<typeof CommsCapture>()),
  resolveCaptureTarget: vi.fn(async () => ({
    entityType: 'contact',
    entityId: 'contact-1',
    contactId: 'contact-1',
    companyId: 'company-1',
    opportunityId: null,
  })),
}));

const orgId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const tokenId = '00000000-0000-4000-8000-000000000003';
const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as pino.Logger;
const upsert = vi.mocked(prisma.emailMessage.upsert);
const tokenUpdate = vi.mocked(prisma.integrationToken.update);
const findToken = vi.mocked(prisma.integrationToken.findFirst);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function tokenRow(provider: 'microsoft_graph' | 'gmail', deltaState: Record<string, unknown>) {
  return {
    id: tokenId,
    orgId,
    userId,
    provider,
    status: 'active',
    externalAccountEmail: 'tony@amaris.com',
    accessTokenEncrypted: 'x',
    refreshTokenEncrypted: 'y',
    expiresAt: null,
    scope: [],
    deltaState,
  } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Outlook inbox capture', () => {
  beforeEach(() => {
    findToken.mockResolvedValue(tokenRow('microsoft_graph', { calendarDeltaLink: 'cal-keep' }));
  });

  it('follows every delta page for inbox and sent items and merges the cursors', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('mailFolders/inbox') && !url.includes('skiptoken')) {
        return json({
          value: [
            {
              id: 'm-1',
              conversationId: 'conv-1',
              from: { emailAddress: { address: 'buyer@acme.com', name: 'Buyer' } },
              toRecipients: [{ emailAddress: { address: 'tony@amaris.com' } }],
              subject: 'RFP questions',
              receivedDateTime: '2026-11-06T14:00:00Z',
              body: { contentType: 'html', content: '<p>Hello</p>' },
            },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=2',
        });
      }
      if (url.includes('skiptoken=2')) {
        return json({ value: [{ id: 'm-draft', isDraft: true }], '@odata.deltaLink': 'inbox-delta' });
      }
      return json({
        value: [
          {
            id: 'm-2',
            conversationId: 'conv-1',
            from: { emailAddress: { address: 'tony@amaris.com' } },
            toRecipients: [{ emailAddress: { address: 'buyer@acme.com' } }],
            subject: 'Re: RFP questions',
            sentDateTime: '2026-11-06T15:00:00Z',
            body: { contentType: 'text', content: 'Answers below' },
          },
        ],
        '@odata.deltaLink': 'sent-delta',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pullDelta({ orgId, userId, integrationTokenId: tokenId }, log);

    expect(result.persisted).toBe(2);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('mailFolders/sentitems'))).toBe(true);
    const rows = upsert.mock.calls.map((c) => c[0] as unknown as { where: unknown; create: Record<string, unknown>; update: unknown });
    expect(rows[0]?.where).toEqual({ orgId_externalMessageId: { orgId, externalMessageId: 'm-1' } });
    expect(rows[0]?.update).toEqual({});
    expect(rows[0]?.create).toMatchObject({
      isOutbound: false,
      bodyHtml: '<p>Hello</p>',
      entityType: 'contact',
      entityId: 'contact-1',
      contactId: 'contact-1',
      companyId: 'company-1',
    });
    expect(rows[1]?.create).toMatchObject({ isOutbound: true, bodyText: 'Answers below' });
    expect(tokenUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deltaState: { calendarDeltaLink: 'cal-keep', mailDeltaLink: 'inbox-delta', mailSentDeltaLink: 'sent-delta' },
        }),
      }),
    );
  });

  it('does not store mail that matches no contact, company or opportunity', async () => {
    // One message per folder (inbox and sent items).
    vi.mocked(resolveCaptureTarget).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          value: [
            {
              id: 'm-hr',
              conversationId: 'conv-hr',
              from: { emailAddress: { address: 'hr@amaris.com' } },
              toRecipients: [{ emailAddress: { address: 'tony@amaris.com' } }],
              subject: 'Your pay slip',
              receivedDateTime: '2026-11-06T14:00:00Z',
              body: { contentType: 'text', content: 'Private' },
            },
          ],
          '@odata.deltaLink': 'delta',
        }),
      ),
    );

    const result = await pullDelta({ orgId, userId, integrationTokenId: tokenId }, log);

    expect(result.persisted).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('looks the token up inside the job org only', async () => {
    findToken.mockResolvedValueOnce(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await pullDelta({ orgId, userId, integrationTokenId: tokenId }, log);
    expect(findToken).toHaveBeenCalledWith(expect.objectContaining({ where: { id: tokenId, orgId } }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

describe('Gmail inbox capture', () => {
  it('seeds from the profile history id, pages the message list and stores bodies', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/users/me/profile')) return json({ emailAddress: 'tony@amaris.com', historyId: '900' });
      if (url.includes('/messages?') && !url.includes('pageToken')) {
        return json({ messages: [{ id: 'g-1', threadId: 't-1' }], nextPageToken: 'p2' });
      }
      if (url.includes('/messages?') && url.includes('pageToken=p2')) {
        return json({ messages: [{ id: 'g-2', threadId: 't-1' }] });
      }
      const id = url.includes('/messages/g-1') ? 'g-1' : 'g-2';
      return json({
        id,
        threadId: 't-1',
        internalDate: '1793973600000',
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: id === 'g-1' ? 'Buyer <buyer@acme.com>' : 'Tony <tony@amaris.com>' },
            { name: 'To', value: id === 'g-1' ? 'tony@amaris.com' : 'buyer@acme.com' },
            { name: 'Cc', value: 'Ops <ops@acme.com>' },
            { name: 'Subject', value: 'Pricing' },
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: b64('Plain body') } },
            { mimeType: 'text/html', body: { data: b64('<p>Html body</p>') } },
          ],
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const persisted = await pullGmail(tokenRow('gmail', { calendarSyncToken: 'keep' }), 'access-token', log);

    expect(persisted).toBe(2);
    const rows = upsert.mock.calls.map((c) => c[0] as unknown as { create: Record<string, unknown> });
    expect(rows[0]?.create).toMatchObject({
      provider: 'GMAIL',
      externalMessageId: 'g-1',
      threadId: 't-1',
      fromEmail: 'buyer@acme.com',
      bodyText: 'Plain body',
      bodyHtml: '<p>Html body</p>',
      isOutbound: false,
      ccEmails: [{ email: 'ops@acme.com', name: 'Ops' }],
      contactId: 'contact-1',
    });
    expect(rows[1]?.create.isOutbound).toBe(true);
    expect(tokenUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deltaState: { calendarSyncToken: 'keep', gmailHistoryId: '900' } }),
      }),
    );
  });

  it('does not store mail that matches no contact, company or opportunity', async () => {
    vi.mocked(resolveCaptureTarget).mockResolvedValueOnce(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/users/me/profile')) return json({ emailAddress: 'tony@amaris.com', historyId: '901' });
        if (url.includes('/messages?')) return json({ messages: [{ id: 'g-hr', threadId: 't-hr' }] });
        return json({
          id: 'g-hr',
          threadId: 't-hr',
          internalDate: '1793973600000',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'HR <hr@amaris.com>' },
              { name: 'To', value: 'tony@amaris.com' },
              { name: 'Subject', value: 'Your pay slip' },
            ],
            body: { data: b64('Private') },
          },
        });
      }),
    );

    const persisted = await pullGmail(tokenRow('gmail', {}), 'access-token', log);

    expect(persisted).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
    expect(tokenUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deltaState: { gmailHistoryId: '901' } }) }),
    );
  });

  it('reads history pages incrementally and resets only its own cursor on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'gone' }, 404)));
    const persisted = await pullGmail(tokenRow('gmail', { gmailHistoryId: '10', calendarSyncToken: 'keep' }), 'at', log);
    expect(persisted).toBe(0);
    expect(tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deltaState: { calendarSyncToken: 'keep' } }) }),
    );
  });
});
