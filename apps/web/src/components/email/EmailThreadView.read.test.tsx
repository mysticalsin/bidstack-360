// An opened thread may say it failed only after the read fails. A pause has
// isLoading false and no messages. That read is still unread. A blank thread
// is only a payload that arrived with no messages.
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

import { EmailThreadView } from './EmailThreadView';

const THREAD = 't1';
const THREAD_PATH = `/api/email/threads/${THREAD}`;
const FAILED = 'Could not load this thread';
const WAITING = 'Checking this thread. The messages have not arrived.';
const BODY = 'Can you confirm the deadline?';

function message() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    fromEmail: 'buyer@client.example',
    bodyText: BODY,
    bodyHtml: null,
    sentAt: '2026-11-05T15:00:00.000Z',
    receivedAt: '2026-11-05T15:00:00.000Z',
    createdAt: '2026-11-05T15:00:00.000Z',
  };
}

function renderThread() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<EmailThreadView threadId={THREAD} />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function expectNoSettledBody() {
  expect(screen.queryByText(BODY)).toBeNull();
  expect(screen.queryByTestId('email-thread')).toBeNull();
}

describe('email thread before the payload arrives', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused thread a failed load', async () => {
    // WHY: a paused first read has isLoading false and no messages. The sheet
    // said the thread failed, while the messages have not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderThread();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
    expectNoSettledBody();
  });

  it('does not call an in-flight thread a failed load', async () => {
    // WHY: the skeleton alone still sat where a missing thread sits. A slow
    // read is not proof this thread failed to load.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderThread();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
    expectNoSettledBody();
  });

  it('still says a failed thread did not load', async () => {
    // WHY: a rejected read is a failed load. The error stays, and the sheet
    // does not pretend the messages are still on the way.
    apiMock.mockImplementation((path: string) => {
      if (path === THREAD_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderThread();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expectNoSettledBody();
  });

  it('still shows a thread that arrived with no messages', async () => {
    // WHY: a payload that arrived with no messages is an empty thread. That
    // list stays, so a real empty thread is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === THREAD_PATH) return Promise.resolve({ threadId: THREAD, subject: 'RFP questions', messages: [] });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderThread();

    expect(await screen.findByTestId('email-thread')).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
    expect(screen.queryByText(BODY)).toBeNull();
  });

  it('still shows a message that has arrived', async () => {
    // WHY: a loaded message stays in the sheet. The unread line must not
    // replace mail the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === THREAD_PATH) {
        return Promise.resolve({ threadId: THREAD, subject: 'RFP questions', messages: [message()] });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderThread();

    expect(await screen.findByText(BODY)).toBeTruthy();
    expect(screen.getByTestId('email-thread')).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('heading', { name: FAILED })).toBeNull();
  });
});
