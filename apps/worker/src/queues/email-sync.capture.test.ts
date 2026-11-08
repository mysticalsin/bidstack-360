// Inbox capture against mocked Graph and Gmail APIs: delta paging, cursor
// merge, sent-items capture, dedupe by provider message id, and filing.
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CommsCapture from '../lib/comms-capture.js';
import { resolveCaptureTarget } from '../lib/comms-capture.js';

import { prisma, syncEmailMessageActivity } from '@bidstack/db';

import { pullDelta } from './email-sync.pull.js';
import { consumeGmailIdPage, pullGmail } from './email-sync.gmail.js';

vi.mock('@bidstack/db', () => ({
  EmailProvider: { GMAIL: 'GMAIL', OUTLOOK: 'OUTLOOK' },
  prisma: {
    unlockedCursorTestAdapter: true,
    integrationToken: { findFirst: vi.fn(), update: vi.fn() },
    emailMessage: { upsert: vi.fn(async () => ({ id: 'row-1' })) },
  },
  syncEmailMessageActivity: vi.fn(async () => ({ action: 'created', activityId: 'act-1' })),
  syncCalendarEventActivity: vi.fn(async () => ({ action: 'created', activityId: 'act-1' })),
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
  upsert.mockReset();
  upsert.mockResolvedValue({ id: 'row-1' } as never);
  findToken.mockReset();
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

  it('turns each stored message into an account activity, and a bridge failure keeps the mail', async () => {
    upsert.mockResolvedValueOnce({ id: 'row-1' } as never).mockResolvedValueOnce({ id: 'row-2' } as never);
    vi.mocked(syncEmailMessageActivity).mockRejectedValueOnce(new Error('db down'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          value: [
            {
              id: 'm-x',
              from: { emailAddress: { address: 'buyer@acme.com' } },
              toRecipients: [{ emailAddress: { address: 'tony@amaris.com' } }],
              subject: 'Hello',
              receivedDateTime: '2026-11-06T14:00:00Z',
            },
          ],
          '@odata.deltaLink': 'delta',
        }),
      ),
    );

    const result = await pullDelta({ orgId, userId, integrationTokenId: tokenId }, log);

    expect(result.persisted).toBe(2);
    expect(syncEmailMessageActivity).toHaveBeenCalledWith(orgId, 'row-1');
    expect(syncEmailMessageActivity).toHaveBeenCalledWith(orgId, 'row-2');
    const saved = tokenUpdate.mock.calls.at(-1)?.[0] as {
      data: { deltaState: Record<string, unknown> };
    };
    // Inbox bridge failed, so that folder's delta link stays unset and the
    // page is kept for another attempt. Sent mail, which bridged, may advance.
    expect(saved.data.deltaState.calendarDeltaLink).toBe('cal-keep');
    expect(saved.data.deltaState.mailDeltaLink).toBeUndefined();
    expect(saved.data.deltaState.mailNextLink).toEqual(expect.stringContaining('mailFolders/inbox'));
    expect(saved.data.deltaState.mailSentDeltaLink).toBe('delta');
  });

  it('does not spend the bridge budget when the Outlook row was never written', async () => {
    const poison = {
      id: 'm-poison',
      from: { emailAddress: { address: 'buyer@acme.com' } },
      toRecipients: [{ emailAddress: { address: 'tony@amaris.com' } }],
      subject: 'Secret subject',
      receivedDateTime: '2026-11-06T14:00:00Z',
    };
    upsert.mockImplementation(async (args: { create?: { externalMessageId?: string } }) => {
      if (args.create?.externalMessageId === 'm-poison') throw new Error('write failed');
      return { id: 'row-ok' } as never;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const target = String(url);
        if (target.includes('sentitems') || target === 'sent-delta') {
          return json({ value: [], '@odata.deltaLink': 'sent-delta' });
        }
        return json({ value: [poison], '@odata.deltaLink': 'inbox-delta' });
      }),
    );

    let state: Record<string, unknown> = { calendarDeltaLink: 'cal-keep' };
    findToken.mockImplementation(async () => tokenRow('microsoft_graph', state));

    for (let attempt = 0; attempt < 3; attempt++) {
      await pullDelta({ orgId, userId, integrationTokenId: tokenId }, log);
      state = (tokenUpdate.mock.calls.at(-1)?.[0] as { data: { deltaState: Record<string, unknown> } }).data.deltaState;
      // The row was never written, so this is not an activity-bridge failure
      // and the inbox cursor must not move on after a quarantine.
      expect(state.activityBridgeRetryById).toBeUndefined();
      expect(state.activityBridgeQuarantine).toBeUndefined();
      expect(state.mailDeltaLink).toBeUndefined();
      expect(state.mailNextLink).toEqual(expect.stringContaining('mailFolders/inbox'));
      expect(state.mailSentDeltaLink).toBe('sent-delta');
      expect(JSON.stringify(state)).not.toContain('Secret subject');
    }
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

  it('still pulls after a failed refresh left the grant in error', async () => {
    findToken.mockResolvedValueOnce({ ...(tokenRow('microsoft_graph', {}) as object), status: 'error' } as never);
    const fetchMock = vi.fn(async () => json({ value: [], '@odata.deltaLink': 'delta' }));
    vi.stubGlobal('fetch', fetchMock);
    await pullDelta({ orgId, userId, integrationTokenId: tokenId }, log);
    expect(fetchMock).toHaveBeenCalled();
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

  it('holds the history cursor when storing a message throws', async () => {
    upsert.mockRejectedValueOnce(new Error('write failed'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/users/me/profile')) return json({ emailAddress: 'tony@amaris.com', historyId: '900' });
        if (url.includes('/messages?')) return json({ messages: [{ id: 'g-poison', threadId: 't-1' }] });
        return json({
          id: 'g-poison',
          threadId: 't-1',
          internalDate: '1793973600000',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'Buyer <buyer@acme.com>' },
              { name: 'To', value: 'tony@amaris.com' },
              { name: 'Subject', value: 'Secret subject' },
            ],
            body: { data: b64('Plain body') },
          },
        });
      }),
    );

    const persisted = await pullGmail(tokenRow('gmail', { calendarSyncToken: 'keep' }), 'access-token', log);
    expect(persisted).toBe(0);
    const saved = tokenUpdate.mock.calls.at(-1)?.[0] as { data: { deltaState: Record<string, unknown> } };
    expect(saved.data.deltaState.gmailHistoryId).toBeUndefined();
    expect(saved.data.deltaState.calendarSyncToken).toBe('keep');
    expect(saved.data.deltaState.activityBridgeRetryById).toBeUndefined();
    expect(saved.data.deltaState.activityBridgeQuarantine).toBeUndefined();
    expect(JSON.stringify(saved.data.deltaState)).not.toContain('Secret subject');
  });

  it('holds the seed cursor when Gmail returns no message body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/users/me/profile')) return json({ emailAddress: 'tony@amaris.com', historyId: '900' });
        if (url.includes('/messages?')) return json({ messages: [{ id: 'g-500', threadId: 't-1' }] });
        return json({ error: 'unavailable' }, 500);
      }),
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      await pullGmail(tokenRow('gmail', { calendarSyncToken: 'keep' }), 'access-token', log);
      const saved = tokenUpdate.mock.calls.at(-1)?.[0] as { data: { deltaState: Record<string, unknown> } };
      expect(saved.data.deltaState.gmailHistoryId).toBeUndefined();
      expect(saved.data.deltaState.activityBridgeQuarantine).toBeUndefined();
      expect(saved.data.deltaState.activityBridgeRetryById).toBeUndefined();
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it('keeps the list page token when a later page is only partly stored', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/users/me/profile')) return json({ emailAddress: 'tony@amaris.com', historyId: '900' });
        if (url.includes('/messages?') && !url.includes('pageToken')) {
          return json({ messages: [{ id: 'g-1' }], nextPageToken: 'p2' });
        }
        if (url.includes('pageToken=p2')) {
          return json({ messages: [{ id: 'g-2' }, { id: 'g-3' }], nextPageToken: 'p3' });
        }
        const id = url.includes('/messages/g-1') ? 'g-1' : 'g-2';
        return json({
          id,
          threadId: 't',
          internalDate: '1793973600000',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'Buyer <buyer@acme.com>' },
              { name: 'To', value: 'tony@amaris.com' },
              { name: 'Subject', value: id },
            ],
            body: { data: b64('body') },
          },
        });
      }),
    );
    await pullGmail(tokenRow('gmail', { calendarSyncToken: 'keep' }), 'access-token', log, 2);
    const saved = tokenUpdate.mock.calls.at(-1)?.[0] as { data: { deltaState: Record<string, unknown> } };
    expect(saved.data.deltaState.gmailListPageToken).toBe('p2');
    expect(saved.data.deltaState.gmailListResumeCount).toBe(1);
    expect(saved.data.deltaState.gmailHistoryId).toBeUndefined();
  });

  it('does not advance history past ids the cap has not stored yet', async () => {
    const page = (ids: string[], next?: string) =>
      json({
        history: [{ id: 'h', messagesAdded: ids.map((id) => ({ message: { id } })) }],
        historyId: '999',
        ...(next ? { nextPageToken: next } : {}),
      });
    const detail = (id: string) =>
      json({
        id,
        threadId: 't',
        internalDate: '1793973600000',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'Buyer <buyer@acme.com>' },
            { name: 'To', value: 'tony@amaris.com' },
            { name: 'Subject', value: id },
          ],
          body: { data: b64('body') },
        },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/history')) return page(['g-a', 'g-b', 'g-c']);
        if (String(url).includes('/messages/g-a')) return detail('g-a');
        if (String(url).includes('/messages/g-b')) return detail('g-b');
        return detail('g-c');
      }),
    );
    const first = await pullGmail(tokenRow('gmail', { gmailHistoryId: '10', calendarSyncToken: 'keep' }), 'at', log, 2);
    expect(first).toBe(2);
    const saved = tokenUpdate.mock.calls.at(-1)?.[0] as { data: { deltaState: Record<string, unknown> } };
    expect(saved.data.deltaState.gmailHistoryId).toBe('10');
    expect(saved.data.deltaState.gmailHistoryResumeCount).toBe(2);
    expect(saved.data.deltaState.calendarSyncToken).toBe('keep');
    const second = await pullGmail(
      tokenRow('gmail', saved.data.deltaState),
      'at',
      log,
      2,
    );
    expect(second).toBe(1);
    const done = tokenUpdate.mock.calls.at(-1)?.[0] as { data: { deltaState: Record<string, unknown> } };
    expect(done.data.deltaState.gmailHistoryId).toBe('999');
    expect(done.data.deltaState.gmailHistoryResumeCount).toBeUndefined();
    const storedIds = upsert.mock.calls.map((call) => (call[0] as { create: { externalMessageId: string } }).create.externalMessageId);
    expect(storedIds).toEqual(['g-a', 'g-b', 'g-c']);
    const firstWrite = upsert.mock.calls[0]?.[0] as {
      where: { orgId_externalMessageId: { externalMessageId: string } };
      update: object;
    };
    // A failed cursor commit retries the same provider id onto one row.
    expect(firstWrite.where.orgId_externalMessageId.externalMessageId).toBe('g-a');
    expect(firstWrite.update).toEqual({});
  });
});

describe('Gmail page checkpoint', () => {
  it('keeps the unread tail of a page and the next page token', () => {
    const mid = consumeGmailIdPage({
      messageIds: ['a', 'b', 'c'],
      nextPageToken: 'page-2',
      resumeCount: 0,
      cap: 2,
    });
    expect(mid).toEqual({ ids: ['a', 'b'], resumeCount: 2, pageToken: null, finished: false });
    const rest = consumeGmailIdPage({
      messageIds: ['a', 'b', 'c'],
      nextPageToken: 'page-2',
      resumeCount: mid.resumeCount,
      cap: 2,
    });
    expect(rest.ids).toEqual(['c']);
    expect(rest.finished).toBe(false);
    expect(rest.pageToken).toBe('page-2');
    const done = consumeGmailIdPage({
      messageIds: ['d'],
      nextPageToken: null,
      resumeCount: 0,
      cap: 2,
    });
    expect(done.finished).toBe(true);
    expect(done.ids).toEqual(['d']);
  });
});
