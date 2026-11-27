// Mail filed on a contact may say "No email yet" only after the list arrives.
// A pause has isLoading false and no rows. That read is still unread. A failure
// with no payload is not an empty mailbox.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
}));

import { EmailPanel } from './EmailPanel';

const CONTACT = '11111111-1111-4111-8111-111111111111';
const MAIL_PATH = `/api/email/messages?contactId=${CONTACT}&limit=25`;
const EMPTY = 'No email yet';
const WAITING = 'Checking email. The list has not arrived.';
const SUBJECT = 'RFP questions';

function message() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    orgId: CONTACT,
    userId: CONTACT,
    provider: 'GMAIL',
    externalMessageId: 'm1',
    threadId: 't1',
    fromEmail: 'buyer@client.example',
    toEmails: [{ email: 'rep@example.test' }],
    ccEmails: [],
    subject: SUBJECT,
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
  };
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<EmailPanel filter={{ contactId: CONTACT }} />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function expectNoSettledMiss() {
  expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
  expect(screen.queryByText(SUBJECT)).toBeNull();
}

describe('contact email list before the payload arrives', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused contact mailbox empty', async () => {
    // WHY: a paused first read has isLoading false and no rows. The panel said
    // No email yet, while the messages filed on this contact have not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPanel();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
    expect(screen.queryByRole('heading', { name: 'Could not load email' })).toBeNull();
  });

  it('does not call an in-flight contact mailbox empty', async () => {
    // WHY: the skeleton alone still sat where a settled empty mailbox sits.
    // A slow read is not proof this contact has no email.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPanel();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a failed contact mailbox empty', async () => {
    // WHY: a failed read is not evidence that nothing is filed. The error stays,
    // and the panel does not say the mailbox is empty.
    apiMock.mockImplementation((path: string) => {
      if (path === MAIL_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Could not load email' })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expectNoSettledMiss();
  });

  it('still says a settled mailbox has no email', async () => {
    // WHY: a payload that arrived with no messages is an empty mailbox. That
    // line stays, so a real empty list is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === MAIL_PATH) return Promise.resolve({ messages: [], total: 0, hasMore: false });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a message that has arrived', async () => {
    // WHY: a loaded subject stays on the contact. The unread line must not
    // replace mail the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === MAIL_PATH) {
        return Promise.resolve({ messages: [message()], total: 1, hasMore: false });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText(SUBJECT)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
