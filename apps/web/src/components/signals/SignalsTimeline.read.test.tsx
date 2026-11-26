// A paused or in-flight signals timeline has no payload yet. The section
// called that a failed load, or left a blank skeleton. An empty list is only
// what a settled read with no events says.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { AccountTimeline, TimelineItem } from '@bidstack/shared';

interface TimelineSnapshot {
  data?: AccountTimeline;
  isLoading: boolean;
  isError: boolean;
  status: string;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  refetch: () => Promise<unknown>;
}

const hookMocks = vi.hoisted(() => ({
  timeline: {
    data: undefined,
    isLoading: false,
    isError: false,
    status: 'pending',
    fetchStatus: 'idle',
    refetch: () => Promise.resolve(),
  } as TimelineSnapshot,
}));

vi.mock('@/hooks/useAccountSignals', () => ({
  useAccountTimeline: () => hookMocks.timeline,
}));

import { SignalsTimeline } from './SignalsTimeline';
import { signalsTimelinePhase, type SignalsTimelineSnapshot } from './signals-timeline-read';

const CHECKING = 'Checking the signals timeline. The payload has not arrived.';
const FAILED = 'The signals timeline did not load.';
const OLD_FAILED = "Couldn't load the timeline";
const EMPTY = 'Nothing on the timeline yet';
const LOADED = 'Sample kickoff workshop';

const EVENT: TimelineItem = {
  id: 'm1',
  at: '2026-06-01T00:00:00.000Z',
  lane: 'ours',
  category: 'meeting',
  title: LOADED,
  summary: 'Synthetic kickoff for Northwind Sample.',
  source: 'meeting_intel',
  sourceUrl: null,
  href: '/meetings/m1',
  importance: 40,
  implication: 'NEUTRAL',
  sample: true,
  upcoming: false,
};

function page(items: TimelineItem[]): AccountTimeline {
  return {
    companyId: 'northwind-sample',
    from: '2025-11-01T00:00:00.000Z',
    to: '2026-10-31T00:00:00.000Z',
    items,
    counts: { meeting: items.length },
  };
}

function settle(data: AccountTimeline | undefined, extra: Partial<TimelineSnapshot> = {}) {
  hookMocks.timeline = {
    data,
    isLoading: false,
    isError: false,
    status: data === undefined ? 'pending' : 'success',
    fetchStatus: 'idle',
    refetch: () => Promise.resolve(),
    ...extra,
  };
}

function renderTimeline() {
  return render(
    <MemoryRouter>
      <SignalsTimeline companyId="northwind-sample" />
    </MemoryRouter>,
  );
}

function expectNotSettled() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByRole('button', { name: new RegExp(LOADED) })).toBeNull();
  expect(screen.queryByText('Sample')).toBeNull();
}

describe('Signals timeline read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused timeline read as an empty list or a failed load', () => {
    // WHY: a paused first read has isLoading false and no payload. "Couldn't
    // load the timeline" is a failed read. "Nothing on the timeline yet" is a
    // settled empty list. This payload has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'paused' });
    renderTimeline();

    expectNotSettled();
    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(OLD_FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an idle unread timeline as an empty list', () => {
    // WHY: a read that has not started is still unread. isLoading is false.
    // The empty sentence must not stand in for a payload that has not arrived.
    settle(undefined, { status: 'pending', fetchStatus: 'idle' });
    renderTimeline();

    expectNotSettled();
    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(OLD_FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight timeline read as a blank list', () => {
    // WHY: a slow read has no payload. A blank skeleton is not an empty
    // timeline, and it is not a failed load. The payload has not arrived.
    settle(undefined, { isLoading: true, status: 'pending', fetchStatus: 'fetching' });
    renderTimeline();

    expectNotSettled();
    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(OLD_FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed timeline read on the error', () => {
    // WHY: a failed read is not an unread pause and not an empty list. It
    // says the timeline did not load.
    settle(undefined, { isError: true, status: 'error', fetchStatus: 'idle' });
    renderTimeline();

    expectNotSettled();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(OLD_FAILED)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('lets a failed status win over a stale timeline', () => {
    // WHY: error wins before a payload. A refetch failure must not keep a
    // workshop from a read that is no longer current, even when isError is
    // still false.
    settle(page([EVENT]), { isError: false, status: 'error', fetchStatus: 'idle' });
    renderTimeline();

    expect(screen.queryByRole('button', { name: new RegExp(LOADED) })).toBeNull();
    expect(screen.queryByText('Sample')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(OLD_FAILED)).toBeNull();
  });

  it('drops a stale timeline when the read is in error', () => {
    // WHY: isError wins even when a previous workshop is still in data.
    // That workshop is not the settled list.
    settle(page([EVENT]), { isError: true, status: 'error', fetchStatus: 'idle' });
    renderTimeline();

    expect(screen.queryByRole('button', { name: new RegExp(LOADED) })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('stays empty when a settled timeline has no events', () => {
    // WHY: a page that arrived with no events is empty. Unread must not
    // replace that sentence, and the empty list must not say the load failed.
    settle(page([]));
    renderTimeline();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(OLD_FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: new RegExp(LOADED) })).toBeNull();
  });

  it('still shows a loaded timeline event', () => {
    // WHY: a loaded workshop stays. The unread sentence is only for a payload
    // that has not arrived.
    settle(page([EVENT]));
    renderTimeline();

    expect(screen.getByRole('button', { name: new RegExp(LOADED) })).toBeTruthy();
    expect(screen.getByText('Sample')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});

function snapshot(overrides: Partial<SignalsTimelineSnapshot>): SignalsTimelineSnapshot {
  return { data: undefined, isError: false, status: 'pending', ...overrides };
}

describe('signalsTimelinePhase', () => {
  it('treats a missing payload as unread, including a pause and a fetch still running', () => {
    // WHY: isLoading is false on a pause. Undefined data is not an empty list
    // and not a failed load.
    expect(signalsTimelinePhase(snapshot({ status: 'pending' }))).toBe('unread');
    expect(signalsTimelinePhase(snapshot({ status: 'pending', data: undefined }))).toBe('unread');
  });

  it('lets error win over a payload that is still in memory', () => {
    // WHY: a newer failure is not the workshop from the previous read.
    expect(signalsTimelinePhase(snapshot({ status: 'error', isError: false, data: page([EVENT]) }))).toBe(
      'failed',
    );
    expect(signalsTimelinePhase(snapshot({ status: 'success', isError: true, data: page([EVENT]) }))).toBe(
      'failed',
    );
  });

  it('keeps a settled page ready, including one with no events', () => {
    // WHY: a page that arrived is the list. An empty page is empty, not unread.
    expect(signalsTimelinePhase(snapshot({ status: 'success', data: page([]) }))).toBe('ready');
    expect(signalsTimelinePhase(snapshot({ status: 'success', data: page([EVENT]) }))).toBe('ready');
  });
});
