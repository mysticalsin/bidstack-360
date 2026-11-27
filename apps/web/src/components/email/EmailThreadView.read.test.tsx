// A paused or in-flight thread read has no payload and isLoading false.
// That must not look like a failed load, an empty thread, or a message
// that already arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EmailThreadMessageDto, EmailThreadResponse } from '@bidstack/shared';

const threadQuery = vi.hoisted(() => ({
  current: {
    data: undefined as EmailThreadResponse | null | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
    error: null as Error | null,
  },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query',
  );
  return {
    ...actual,
    useQuery: () => threadQuery.current,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, unknown>) => {
      const text = fallback ?? key;
      if (!vars) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

import { EmailThreadView } from './EmailThreadView';

const CHECKING = 'Checking this thread. It has not arrived.';
const FAILED = 'Could not load this thread';
const FROM = 'ada@northwind.example';
const BODY = 'The printer quote is attached.';
const THREAD_ID = 't-northwind-printer';

function message(bodyText: string | null, fromEmail = FROM): EmailThreadMessageDto {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    orgId: '11111111-1111-4111-8111-111111111111',
    userId: '11111111-1111-4111-8111-111111111111',
    provider: 'GMAIL',
    externalMessageId: 'm1',
    threadId: THREAD_ID,
    fromEmail,
    toEmails: [],
    ccEmails: [],
    subject: 'Northwind printer quote',
    bodyText,
    bodyHtml: null,
    isOutbound: false,
    sentAt: '2026-11-05T15:00:00.000Z',
    receivedAt: '2026-11-05T15:00:00.000Z',
    openedAt: null,
    clickedAt: null,
    entityType: null,
    entityId: null,
    contactId: null,
    createdAt: '2026-11-05T15:00:00.000Z',
  };
}

function payload(
  messages: EmailThreadMessageDto[],
  subject = 'Northwind printer quote',
): EmailThreadResponse {
  return { threadId: THREAD_ID, subject, messages };
}

function unread(status: string, isLoading = false) {
  threadQuery.current = {
    data: undefined,
    isLoading,
    isError: false,
    status,
    error: null,
  };
}

function renderThread() {
  return render(<EmailThreadView threadId={THREAD_ID} />);
}

describe('email thread read', () => {
  afterEach(() => {
    cleanup();
    unread('pending');
  });

  it('does not treat a paused thread as a failed load', () => {
    unread('idle', false);
    renderThread();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(FROM)).toBeNull();
    expect(screen.queryByTestId('email-thread')).toBeNull();
  });

  it('does not treat an in-flight thread as a failed load when isLoading is false', () => {
    unread('pending', false);
    renderThread();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(FROM)).toBeNull();
  });

  it('does not treat an in-flight thread as only a skeleton', () => {
    unread('pending', true);
    renderThread();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(FROM)).toBeNull();
  });

  it('keeps a failed thread on the error when isError is true', () => {
    threadQuery.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
      error: new Error('mail down'),
    };
    renderThread();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FROM)).toBeNull();
    expect(screen.queryByTestId('email-thread')).toBeNull();
  });

  it('drops a stale message when isError is true', () => {
    threadQuery.current = {
      data: payload([message(BODY)]),
      isLoading: false,
      isError: true,
      status: 'error',
      error: new Error('mail down'),
    };
    renderThread();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(FROM)).toBeNull();
    expect(screen.queryByText(BODY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('drops a stale message when the status is error and isError is still false', () => {
    threadQuery.current = {
      data: payload([message(BODY)]),
      isLoading: false,
      isError: false,
      status: 'error',
      error: null,
    };
    renderThread();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(FROM)).toBeNull();
    expect(screen.queryByText(BODY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('treats a settled null payload as an empty thread', () => {
    threadQuery.current = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
      error: null,
    };
    renderThread();
    expect(screen.getByTestId('email-thread')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(FROM)).toBeNull();
  });

  it('stays empty when a settled thread has no messages', () => {
    threadQuery.current = {
      data: payload([]),
      isLoading: false,
      isError: false,
      status: 'success',
      error: null,
    };
    renderThread();
    expect(screen.getByTestId('email-thread').textContent).toBe('');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a message that arrived', () => {
    threadQuery.current = {
      data: payload([message(BODY)]),
      isLoading: false,
      isError: false,
      status: 'success',
      error: null,
    };
    renderThread();
    expect(screen.getByText(FROM)).toBeTruthy();
    expect(screen.getByText(BODY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a message when the body is blank', () => {
    threadQuery.current = {
      data: payload([message('')], ''),
      isLoading: false,
      isError: false,
      status: 'success',
      error: null,
    };
    renderThread();
    expect(screen.getByText(FROM)).toBeTruthy();
    expect(screen.queryByText(BODY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
