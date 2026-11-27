// The calls detail transcript receives an empty segment list until the
// call payload arrives. That is the same shape as a settled call with no
// transcript, so the viewer said "Transcript not yet available." A paused
// or failed read has not produced a transcript. It is not an empty one.
import type { ReactNode } from 'react';

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TranscriptSegment } from '@/hooks/useCalls';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback?: string | Record<string, unknown>,
      values?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === 'string' ? fallback : _key;
      const vars = typeof fallback === 'object' && fallback ? fallback : values;
      if (!vars) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

import { CallTranscriptViewer } from './CallTranscriptViewer';

const CALL_ID = 'call-northwind';
const DETAIL_PATH = `/api/calls/${CALL_ID}`;
const NOT_AVAILABLE = 'Transcript not yet available.';
const WAITING = 'Checking the transcript. The call has not arrived.';
const FAILED = 'Failed to load the transcript.';
const ARRIVED = 'Northwind demo: the pilot starts in March.';

const SEGMENT: TranscriptSegment = {
  speaker: 'Alex Demo',
  startMs: 0,
  endMs: 1000,
  text: 'Northwind demo line from the parent.',
};

function renderViewer(
  props: Partial<{
    callId: string;
    segments: TranscriptSegment[];
    transcriptText: string;
  }> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'online' } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <CallTranscriptViewer
      callId={props.callId}
      segments={props.segments ?? []}
      transcriptText={props.transcriptText}
    />,
    { wrapper: Wrapper },
  );
}

function hang(): Promise<never> {
  return new Promise(() => {});
}

function detail(call: { transcriptText: string | null; transcriptStructured: TranscriptSegment[] | null }) {
  return { call };
}

describe('CallTranscriptViewer unread read', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    onlineManager.setOnline(true);
  });

  it('does not call a paused transcript read unavailable', async () => {
    // WHY: a paused first read has no transcript yet. The viewer used the
    // empty prop list and said the transcript was not yet available.
    onlineManager.setOnline(false);
    apiMock.mockImplementation(hang);

    renderViewer({ callId: CALL_ID });

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight transcript read unavailable', async () => {
    // WHY: opening the transcript tab while the call is still loading
    // passed an empty segment list. A slow read is not a missing transcript.
    onlineManager.setOnline(true);
    apiMock.mockImplementation(hang);

    renderViewer({ callId: CALL_ID });

    expect(await screen.findByText(WAITING)).toBeTruthy();
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull();
  });

  it('does not call a failed transcript read unavailable', async () => {
    // WHY: a failed call read is not evidence the transcript is empty.
    // The error stays, and the unavailable line does not.
    apiMock.mockImplementation((path: string) => {
      if (path === DETAIL_PATH) return Promise.reject(new Error('network down'));
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderViewer({ callId: CALL_ID });

    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still says a settled call has no transcript', async () => {
    // WHY: a payload that arrived without a transcript is a real gap.
    // That line stays, so a processed call with nothing to read is not
    // dressed up as a slow network.
    apiMock.mockImplementation((path: string) => {
      if (path === DETAIL_PATH) {
        return Promise.resolve(detail({ transcriptText: null, transcriptStructured: [] }));
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderViewer({ callId: CALL_ID });

    expect(await screen.findByText(NOT_AVAILABLE)).toBeTruthy();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('still shows a transcript the call read returned', async () => {
    // WHY: once the call payload has a transcript, the empty props the
    // detail panel passes before that payload must not hide the line.
    apiMock.mockImplementation((path: string) => {
      if (path === DETAIL_PATH) {
        return Promise.resolve(detail({ transcriptText: ARRIVED, transcriptStructured: [] }));
      }
      return Promise.reject(new Error(`unhandled: ${path}`));
    });

    renderViewer({ callId: CALL_ID });

    expect(await screen.findByText(ARRIVED)).toBeTruthy();
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it('still shows segments a caller passed without a call id', () => {
    // WHY: a parent that already holds the transcript and does not pass a
    // call id keeps the speaker line. The unread check is for a call read.
    renderViewer({ segments: [SEGMENT] });

    expect(screen.getByText(SEGMENT.text)).toBeTruthy();
    expect(screen.queryByText(NOT_AVAILABLE)).toBeNull();
    expect(screen.queryByText(WAITING)).toBeNull();
  });
});
