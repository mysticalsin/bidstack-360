// The closed-bid debrief asks for the win/loss record as soon as the card
// opens. Until that read arrives, "No debrief recorded yet" is not a result.
// A paused read has no payload and isLoading is false, so the card says the
// debrief was read and found empty. An in-flight read is the same unread
// record. That sentence is for a read that arrived with no debrief. Under
// demo synthetic data the debrief is not empty.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WinLossRecord } from '@bidstack/shared';

import { LessonsLearnedCard } from './LessonsLearnedCard';

const recordState = vi.hoisted(() => ({
  data: undefined as WinLossRecord | null | undefined,
  isPending: true,
  isLoading: false,
  isFetching: false,
  isPaused: false,
  isError: false,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  error: null as Error | null,
  refetch: vi.fn(() => Promise.resolve()),
}));

const canWrite = vi.hoisted(() => ({ value: true }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => canWrite.value,
}));

vi.mock('@/hooks/useWinLoss', () => ({
  useWinLossRecord: () => recordState,
  useUpsertWinLoss: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Synthetic demo debrief. example.test is not a person. The note is what the
// card shows once the read arrives. It must not be treated as absent before that.
const DEMO_OPP = '88888888-8888-4888-8888-888888888888';
const DEMO_RECORD: WinLossRecord = {
  id: '99999999-9999-4999-8999-999999999999',
  opportunityId: DEMO_OPP,
  outcome: 'lost',
  reason: 'price',
  competitor: 'Demo Rival',
  note: 'Demo North tunnel lost on the rate card',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-02T10:00:00.000Z',
};

const CHECKING = 'Checking the win/loss debrief. It has not arrived.';
const FAILED = 'Could not load the debrief. Refresh to try again.';
const EMPTY = 'No debrief recorded yet — capture it while it is fresh.';
const EMPTY_READONLY = 'No debrief recorded for this bid yet.';
const EMPTY_LIE = /no debrief recorded|no reviews|review is empty|unavailable|all clear/i;

function setRecord(next: Partial<typeof recordState>) {
  recordState.data = undefined;
  recordState.isPending = false;
  recordState.isLoading = false;
  recordState.isFetching = false;
  recordState.isPaused = false;
  recordState.isError = false;
  recordState.fetchStatus = 'idle';
  recordState.error = null;
  recordState.refetch.mockClear();
  Object.assign(recordState, next);
}

function renderCard(outcome: 'won' | 'lost' | null = 'lost') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LessonsLearnedCard opportunityId={DEMO_OPP} outcome={outcome} />
    </QueryClientProvider>,
  );
}

function expectNotSettledEmpty() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(EMPTY_READONLY)).toBeNull();
  expect(screen.queryByText(EMPTY_LIE)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Record debrief' })).toBeNull();
  expect(screen.queryByText(DEMO_RECORD.note!)).toBeNull();
  expect(screen.queryByText('Demo Rival')).toBeNull();
}

describe('LessonsLearnedCard win/loss read', () => {
  beforeEach(() => {
    canWrite.value = true;
    setRecord({ isPending: true, fetchStatus: 'idle' });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread win/loss debrief empty', () => {
    // WHY: the closed bid paints the debrief before the request starts.
    // fetchStatus is idle and isLoading is false, so "No debrief recorded yet"
    // looks like a record that was read and found clear. The synthetic Demo
    // North tunnel debrief has not been read. That is not an empty debrief.
    setRecord({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderCard();

    expect(screen.getByText('Lessons Learned')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotSettledEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call a paused win/loss debrief empty', () => {
    // WHY: a paused read (offline demo tab) has no debrief in hand. isLoading
    // is false because the fetch is not running. The empty sentence would say
    // Demo North tunnel already has no win/loss record.
    setRecord({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderCard();

    expect(screen.getByText('Lessons Learned')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotSettledEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight win/loss debrief empty', () => {
    // WHY: the first fetch is the same unread record. A loading pulse is not
    // a result, and "No debrief recorded yet" is a debrief that arrived empty.
    setRecord({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    renderCard();

    expect(screen.getByText('Lessons Learned')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotSettledEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an unread read-only debrief empty', () => {
    // WHY: a reader without write permission still has not received the
    // record. "No debrief recorded for this bid yet" is the settled empty
    // sentence, including for Demo North tunnel.
    canWrite.value = false;
    setRecord({ isPending: true, isLoading: false, fetchStatus: 'idle' });
    renderCard();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotSettledEmpty();
  });

  it('keeps a failed win/loss debrief as an error with retry', () => {
    // WHY: a failed read is not a bid that closed with no debrief. The empty
    // sentence would hide the failure. Retry stays on the failed read.
    const refetch = vi.fn(() => Promise.resolve());
    setRecord({
      isError: true,
      isPending: false,
      fetchStatus: 'idle',
      error: new Error('Win/loss debrief unavailable'),
      refetch,
    });
    renderCard();

    expect(screen.getByText('Lessons Learned')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('Win/loss debrief unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(EMPTY_READONLY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DEMO_RECORD.note!)).toBeNull();
  });

  it('keeps a settled empty debrief empty', () => {
    // WHY: a read that arrived with no record really has no debrief. That
    // sentence is the result, not a payload that has not arrived.
    setRecord({ data: null, isPending: false, fetchStatus: 'idle' });
    renderCard();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record debrief' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(DEMO_RECORD.note!)).toBeNull();
  });

  it('keeps a settled empty read-only debrief empty', () => {
    // WHY: a reader who cannot write still needs the arrived-empty sentence.
    // Checking is only for a record that has not arrived.
    canWrite.value = false;
    setRecord({ data: null, isPending: false, fetchStatus: 'idle' });
    renderCard();

    expect(screen.getByText(EMPTY_READONLY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record debrief' })).toBeNull();
  });

  it('keeps a loaded synthetic debrief on the card', () => {
    // WHY: a payload that arrived, including one demo Demo North tunnel note,
    // is the debrief. The hold is only for a read that has not arrived.
    setRecord({ data: DEMO_RECORD, isPending: false, fetchStatus: 'idle' });
    renderCard();

    expect(screen.getByText('Lessons Learned')).toBeTruthy();
    expect(screen.getByText(DEMO_RECORD.note!)).toBeTruthy();
    expect(screen.getByDisplayValue('Demo Rival')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('keeps a loaded debrief when a later read fails', () => {
    // WHY: a refresh that fails does not erase a debrief already on screen.
    // The failure sentence is for a read that never arrived.
    setRecord({
      data: DEMO_RECORD,
      isError: true,
      isFetching: false,
      isPending: false,
      fetchStatus: 'idle',
      error: new Error('Win/loss debrief unavailable'),
    });
    renderCard();

    expect(screen.getByText(DEMO_RECORD.note!)).toBeTruthy();
    expect(screen.getByDisplayValue('Demo Rival')).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Win/loss debrief unavailable')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
