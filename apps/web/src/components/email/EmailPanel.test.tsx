import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftComposer, DRAFT_ONLY_COPY } from './DraftComposer';
import { EmailPanel } from './EmailPanel';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      values ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? '')) : fallback,
  }),
}));
vi.mock('@/lib/api', () => ({ api: mocks.api }));

const CONTACT = '11111111-1111-4111-8111-111111111111';

function message(over: Record<string, unknown>) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    orgId: CONTACT,
    userId: CONTACT,
    provider: 'GMAIL',
    externalMessageId: 'm1',
    threadId: 't1',
    fromEmail: 'buyer@client.example',
    toEmails: [{ email: 'rep@mantu.com' }],
    ccEmails: [],
    subject: 'RFP questions',
    bodyText: 'Can you confirm the deadline?',
    isOutbound: false,
    sentAt: '2026-11-05T15:00:00.000Z',
    receivedAt: '2026-11-05T15:00:00.000Z',
    openedAt: null,
    clickedAt: null,
    entityType: null,
    entityId: null,
    contactId: CONTACT,
    createdAt: '2026-11-05T15:00:00.000Z',
    ...over,
  };
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/email/messages')) {
      return { messages: [message({})], total: 1, hasMore: false };
    }
    if (path === '/api/email/threads/t1') {
      return {
        threadId: 't1',
        subject: 'RFP questions',
        messages: [
          {
            ...message({}),
            bodyHtml:
              '<p>Can you confirm the deadline?</p><script>alert(1)</script>' +
              '<img src="https://tracker.example/p.gif">' +
              '<div class="gmail_quote"><p>Earlier message</p></div>',
          },
        ],
      };
    }
    if (path === '/api/email/drafts') return { id: 'd1', status: 'draft' };
    return null;
  });
});
afterEach(() => cleanup());

describe('EmailPanel', () => {
  it('lists threads filed on the contact', async () => {
    wrap(<EmailPanel filter={{ contactId: CONTACT }} defaultTo="buyer@client.example" />);
    expect(await screen.findByText('RFP questions')).toBeTruthy();
    expect(mocks.api).toHaveBeenCalledWith(`/api/email/messages?contactId=${CONTACT}&limit=25`);
  });

  it('loads older pages so threads past the first 25 messages stay reachable', async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path.endsWith('&page=2')) {
        return { messages: [message({ id: '33333333-3333-4333-8333-333333333333', threadId: 't2', subject: 'Older bid' })], total: 26, hasMore: false };
      }
      return { messages: [message({})], total: 26, hasMore: true };
    });
    wrap(<EmailPanel filter={{ contactId: CONTACT }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load older email' }));
    expect(await screen.findByText('Older bid')).toBeTruthy();
    expect(screen.getByText('RFP questions')).toBeTruthy();
    expect(mocks.api).toHaveBeenCalledWith(`/api/email/messages?contactId=${CONTACT}&limit=25&page=2`);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load older email' })).toBeNull());
  });

  it('opens a readable thread with scripts stripped, images blocked and quotes collapsed', async () => {
    wrap(<EmailPanel filter={{ contactId: CONTACT }} />);
    fireEvent.click(await screen.findByText('RFP questions'));
    const thread = await screen.findByTestId('email-thread');
    await waitFor(() => expect(within(thread).getByText('Can you confirm the deadline?')).toBeTruthy());
    expect(thread.innerHTML).not.toContain('<script');
    expect(thread.innerHTML).not.toContain('tracker.example');
    expect(within(thread).getByText(/1 remote image blocked/)).toBeTruthy();
    expect(within(thread).queryByText('Earlier message')).toBeNull();
    fireEvent.click(within(thread).getByRole('button', { name: 'Show quoted text' }));
    expect(within(thread).getByText('Earlier message')).toBeTruthy();
  });
});

describe('DraftComposer', () => {
  it('pins the drafts-only promise and offers no send button', () => {
    wrap(<DraftComposer defaultTo="buyer@client.example" link={{ contactId: CONTACT }} onClose={vi.fn()} />);
    expect(DRAFT_ONLY_COPY).toBe('Saved as a draft in Polo. Nothing is sent.');
    expect(screen.getByText(DRAFT_ONLY_COPY)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^send/i })).toBeNull();
  });

  it('saves a draft with a retry key, then offers copy and the mail app', async () => {
    wrap(<DraftComposer defaultTo="buyer@client.example" link={{ contactId: CONTACT }} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Deadline' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Friday at noon.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/email/drafts', expect.anything()));
    const [, init] = mocks.api.mock.calls.find(([p]) => p === '/api/email/drafts') ?? [];
    const body = (init as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({
      to: [{ email: 'buyer@client.example' }],
      subject: 'Deadline',
      text: 'Friday at noon.',
      contactId: CONTACT,
    });
    expect(String(body.clientRequestId)).toMatch(/^[0-9a-f-]{36}$/);

    const open = await screen.findByRole('link', { name: 'Open in mail app' });
    expect(open.getAttribute('href')).toBe(
      'mailto:buyer%40client.example?subject=Deadline&body=Friday%20at%20noon.',
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    for (const label of ['To', 'Subject', 'Message']) {
      expect(screen.getByLabelText(label).hasAttribute('readonly')).toBe(true);
    }
  });

  it('refuses an invalid recipient before saving', () => {
    wrap(<DraftComposer defaultTo="" link={{}} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'not an email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByRole('alert').textContent).toMatch(/email address/i);
    expect(mocks.api).not.toHaveBeenCalled();
  });
});
