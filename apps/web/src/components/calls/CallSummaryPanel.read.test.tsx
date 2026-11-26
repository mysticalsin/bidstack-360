// A paused or in-flight call summary has no payload yet. The panel used the
// same blank as a call that never arrived. The summary has not arrived, so
// that blank is not a finding.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CallDetail } from '@/hooks/useCalls';

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

import { CallSummaryPanel } from './CallSummaryPanel';

const CALL_ID = 'call_northwind_demo';
const CALL_PATH = `/api/calls/${CALL_ID}`;
const WAITING = 'Checking the call summary. The summary has not arrived.';
const SUMMARY = 'Northwind demo: the pilot starts in March.';
const MISSING_TRANSCRIPT =
  'Transcript not available. Insights will be extracted after the recording is processed.';

function call(partial: Partial<CallDetail> = {}): CallDetail {
  return {
    id: CALL_ID,
    orgId: 'org_demo',
    userId: 'user_demo',
    entityType: 'OPPORTUNITY',
    entityId: 'opp_northwind',
    provider: 'ZOOM',
    externalMeetingId: null,
    joinUrl: null,
    scheduledAt: null,
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
    transcriptText: null,
    transcriptStructured: null,
    signedRecordingUrl: null,
    summaries: [],
    ...partial,
  };
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<CallSummaryPanel callSessionId={CALL_ID} />, { wrapper: Wrapper });
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function expectNoSettledMiss() {
  expect(screen.queryByText(SUMMARY)).toBeNull();
  expect(screen.queryByText(MISSING_TRANSCRIPT)).toBeNull();
  expect(screen.queryByText('Failed to load call summary.')).toBeNull();
  expect(screen.queryByText(/No MEDDIC signals extracted/)).toBeNull();
}

describe('CallSummaryPanel unread summary', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused summary read a missing summary', async () => {
    // WHY: a paused first read has isLoading false and no payload. The panel
    // rendered nothing, while the summary has not arrived.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderPanel();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call an in-flight summary read a missing summary', async () => {
    // WHY: the skeleton alone still sat where a missing summary sits. A slow
    // read is not a call with no summary.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderPanel();

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expectNoSettledMiss();
  });

  it('does not call a failed summary read a missing summary', async () => {
    // WHY: a failed read is not evidence that the call has no summary. The
    // error stays, and the panel does not go blank.
    apiMock.mockImplementation((path: string) => {
      if (path === CALL_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Failed to load call summary.')).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(MISSING_TRANSCRIPT)).toBeNull();
    expect(screen.queryByText(SUMMARY)).toBeNull();
  });

  it('still shows a settled call that has no summary', async () => {
    // WHY: a call that arrived with no transcript is a miss. That sentence
    // stays, so a real empty summary is not dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === CALL_PATH) return Promise.resolve({ call: call() });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText(MISSING_TRANSCRIPT)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(SUMMARY)).toBeNull();
  });

  it('still shows a summary that has arrived', async () => {
    // WHY: a loaded summary stays on the panel. The unread line must not
    // replace a summary the read already returned.
    apiMock.mockImplementation((path: string) => {
      if (path === CALL_PATH) return Promise.resolve({ call: call({ summary: SUMMARY }) });
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderPanel();

    expect(await screen.findByText(SUMMARY)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(MISSING_TRANSCRIPT)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
