// A paused or in-flight call detail has no payload yet. The expanded card
// used the failed-load sentence for that missing payload. The detail has not
// arrived, so that sentence is not a finding.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CallSession } from '@/hooks/useCalls';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const vars = typeof fallback === 'object' && fallback ? fallback : values;
      const template = typeof fallback === 'string' ? fallback : key;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));

import { CallTimeline, CallTimelineCard } from './CallTimeline';

const CALL_ID = 'call_northwind_demo';
const CALL_PATH = `/api/calls/${CALL_ID}`;
const WAITING = 'Checking the call detail. The detail has not arrived.';
const FAILED = 'Failed to load call details.';
const SUMMARY = 'Northwind demo: the pilot starts in March.';
const EMPTY_LIST = 'No calls recorded yet.';

function session(partial: Partial<CallSession> = {}): CallSession {
  return {
    id: CALL_ID,
    orgId: 'org_demo',
    userId: 'user_demo',
    entityType: 'OPPORTUNITY',
    entityId: 'opp_northwind',
    provider: 'ZOOM',
    externalMeetingId: null,
    joinUrl: null,
    scheduledAt: '2026-11-01T15:00:00.000Z',
    startedAt: '2026-11-01T15:00:00.000Z',
    endedAt: '2026-11-01T15:30:00.000Z',
    durationSec: 1800,
    participantEmails: [],
    recordingUrl: null,
    summary: null,
    actionItems: [],
    sentimentScore: null,
    talkRatio: null,
    status: 'COMPLETED',
    createdAt: '2026-11-01T15:00:00.000Z',
    updatedAt: '2026-11-01T15:30:00.000Z',
    ...partial,
  };
}

function renderCard(call: CallSession = session()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const view = render(<CallTimelineCard call={call} />, { wrapper: Wrapper });
  return { client, ...view };
}

function expand() {
  // The header is the collapsed button. Its name is the visible row, not the
  // article label, so match the collapsed control.
  fireEvent.click(screen.getByRole('button', { expanded: false }));
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function expectNoSettledDetail() {
  expect(screen.queryByText(SUMMARY)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
  expect(screen.queryByText(EMPTY_LIST)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Re-extract insights' })).toBeNull();
}

describe('CallTimeline unread detail', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused detail read a failed load', async () => {
    // WHY: a paused first read has isLoading false and no payload. The card
    // said the load failed, while the detail has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderCard();
    expand();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledDetail();
  });

  it('does not call an in-flight detail read a failed load', async () => {
    // WHY: the skeleton alone still sat where a failed load sits. A slow
    // read is not a call whose detail failed.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderCard();
    expand();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledDetail();
  });

  it('does not call a failed detail read a missing detail', async () => {
    // WHY: a failed read is not evidence that the call has no detail. The
    // error stays, and the card does not say the detail is still on the way.
    apiMock.mockImplementation((path: string) => {
      if (path === CALL_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderCard();
    expand();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(SUMMARY)).toBeNull();
    expect(screen.queryByText(EMPTY_LIST)).toBeNull();
  });

  it('keeps a detail that already arrived when a later read fails', async () => {
    // WHY: a later failure must not replace a detail the read already
    // returned with the failed-load sentence.
    let fail = false;
    apiMock.mockImplementation((path: string) => {
      if (path !== CALL_PATH) return Promise.reject(new Error(`unhandled: ${path}`));
      if (fail) return Promise.reject(new Error('network down'));
      return Promise.resolve({ call: { ...session(), summary: SUMMARY, transcriptText: null } });
    });

    const { client } = renderCard(session({ summary: SUMMARY }));
    expand();

    expect(await screen.findByText(SUMMARY)).toBeTruthy();

    fail = true;
    await client.invalidateQueries({ queryKey: ['call', CALL_ID] });
    await waitFor(() => {
      const state = client.getQueryState(['call', CALL_ID]);
      expect(state?.fetchStatus).toBe('idle');
      expect(state?.status).toBe('error');
    });

    expect(screen.getByText(SUMMARY)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still shows a settled call that has no summary', async () => {
    // WHY: a call that arrived with no summary is a miss on the summary, not
    // a failed detail read. The re-extract action stays.
    apiMock.mockImplementation((path: string) => {
      if (path === CALL_PATH) return Promise.resolve({ call: { ...session(), transcriptText: null } });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderCard();
    expand();

    expect(await screen.findByRole('button', { name: 'Re-extract insights' })).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(SUMMARY)).toBeNull();
    expect(screen.queryByText(EMPTY_LIST)).toBeNull();
  });

  it('still shows a summary that has arrived', async () => {
    // WHY: a loaded summary stays on the card. The unread line must not
    // replace a summary the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === CALL_PATH) {
        return Promise.resolve({ call: { ...session(), summary: SUMMARY, transcriptText: 'Demo transcript.' } });
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderCard(session({ summary: SUMMARY }));
    expand();

    expect(await screen.findByText(SUMMARY)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still says when a settled timeline has no calls', () => {
    // WHY: an empty array handed to the timeline is a settled history. That
    // sentence stays, so a real empty list is not dressed up as a slow read.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    render(
      <CallTimeline entityType="OPPORTUNITY" entityId="opp_northwind" calls={[]} />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText(EMPTY_LIST)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
