// A paused or in-flight meeting read has no record yet. The page still said
// the load failed, which is the same screen as a failure, or showed only the
// skeleton. That is not a settled missing meeting. The record has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MeetingIntelDetail } from '@bidstack/shared';

import { ApiError } from '@/lib/api';

const hookMocks = vi.hoisted(() => ({
  detail: {
    data: undefined as MeetingIntelDetail | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    status: 'pending' as string,
    fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
    refetch: vi.fn(),
  },
}));

vi.mock('@/hooks/useMeetingIntel', () => ({
  useMeeting: () => hookMocks.detail,
  useFlagMeeting: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    status: 'pending',
    fetchStatus: 'idle',
    refetch: vi.fn(),
  }),
  usePatchMeeting: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));

import MeetingDetailPage from './MeetingDetailPage';

const CHECKING = 'Checking this meeting. The record has not arrived.';
const FAILED = "Couldn't load this meeting";
const NOT_FOUND = 'Meeting not found';
const NO_NOTES = 'No notes captured for this meeting.';
const NO_ATTENDEES = 'No client attendees recorded.';
const NO_TRANSCRIPT = 'No transcript stored. Transcripts are kept only when a Métis user opts in.';

const MEETING_ID = '11111111-1111-4111-8111-111111111111';

const loaded: MeetingIntelDetail = {
  id: MEETING_ID,
  companyId: '22222222-2222-4222-8222-222222222222',
  companyName: 'Harbor Sample',
  title: 'Sample quarterly review',
  heldAt: '2026-06-01T10:00:00.000Z',
  visibility: 'account_team',
  sources: ['manual'],
  attendeeCount: 1,
  topSeniority: 'director',
  challenges: ['Sample challenge'],
  nextSteps: ['Send the sample note'],
  summary: 'Sample summary of the demo meeting',
  transcript: 'Sample transcript line',
  similarProjects: [],
  opportunities: [],
  attendees: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Avery Sample',
      email: null,
      title: null,
      seniority: 'director',
      region: null,
      businessUnit: null,
      isInternal: false,
      contactId: null,
      reportsToContactId: null,
    },
  ],
  sourceLinks: [],
  createdAt: '2026-06-01T10:00:00.000Z',
};

const settledEmpty: MeetingIntelDetail = {
  ...loaded,
  summary: null,
  transcript: null,
  challenges: [],
  nextSteps: [],
  similarProjects: [],
  opportunities: [],
  attendees: [],
  attendeeCount: 0,
};

function settle(
  data: MeetingIntelDetail | undefined,
  extra: Partial<typeof hookMocks.detail> = {},
) {
  hookMocks.detail = {
    data,
    isLoading: false,
    isError: false,
    error: null,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    refetch: vi.fn(),
    ...extra,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/meetings/${MEETING_ID}`]}>
      <Routes>
        <Route path="/meetings/:id" element={<MeetingDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function expectNoSettledRecord() {
  expect(screen.queryByText(NOT_FOUND)).toBeNull();
  expect(screen.queryByText(NO_NOTES)).toBeNull();
  expect(screen.queryByText(NO_ATTENDEES)).toBeNull();
  expect(screen.queryByText(NO_TRANSCRIPT)).toBeNull();
  expect(screen.queryByText(loaded.title)).toBeNull();
  expect(screen.queryByText(loaded.summary!)).toBeNull();
  expect(screen.queryByText('Avery Sample')).toBeNull();
}

describe('MeetingDetailPage unread record', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not call a paused meeting read a missing record', async () => {
    // WHY: a paused first read has isLoading false and no payload. The page
    // said the load failed, while the meeting has not arrived and is not gone.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderPage();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledRecord();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not call an in-flight meeting read a missing record', async () => {
    // WHY: a slow read showed only the loading skeleton. A record that has
    // not arrived is not a meeting the API closed as missing.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderPage();

    expect(await screen.findByText(CHECKING)).toBeTruthy();
    expectNoSettledRecord();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not call a failed meeting read a missing record', async () => {
    // WHY: a failed read is not evidence that the meeting was deleted. The
    // error stays, and the page does not say the meeting is not found.
    settle(undefined, {
      isError: true,
      status: 'error',
      fetchStatus: 'idle',
      error: new Error('offline'),
    });
    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expectNoSettledRecord();
  });

  it('still says a settled 404 is a missing meeting', async () => {
    // WHY: a record the server closed as missing stays on that sentence. A
    // slow network must not be dressed up as that outcome, and this one must.
    settle(undefined, {
      isError: true,
      status: 'error',
      fetchStatus: 'idle',
      error: new ApiError('nf', 404, null),
    });
    renderPage();

    expect(await screen.findByText(NOT_FOUND)).toBeTruthy();
    expect(screen.getByText('It may be archived, or visible only to its account team.')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NO_NOTES)).toBeNull();
    expect(screen.queryByText(loaded.title)).toBeNull();
  });

  it('still shows a settled meeting that arrived with no notes', async () => {
    // WHY: a meeting that arrived with no notes, no client attendees, and no
    // transcript is empty. Those sentences stay, so a real empty record is
    // not dressed up as a slow network.
    settle(settledEmpty);
    renderPage();

    expect(await screen.findByText(settledEmpty.title)).toBeTruthy();
    expect(screen.getByText(NO_NOTES)).toBeTruthy();
    expect(screen.getByText(NO_ATTENDEES)).toBeTruthy();
    expect(screen.getByText(NO_TRANSCRIPT)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows a meeting that arrived', async () => {
    // WHY: a loaded meeting stays on the page. The unread line must not
    // replace a record the read already returned.
    settle(loaded);
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: loaded.title })).toBeTruthy();
    expect(screen.getByText(loaded.summary!)).toBeTruthy();
    expect(screen.getByText('Avery Sample')).toBeTruthy();
    expect(screen.getByText('Sample challenge')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NO_NOTES)).toBeNull();
    expect(screen.queryByText(NO_ATTENDEES)).toBeNull();
    expect(screen.queryByText(NO_TRANSCRIPT)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
