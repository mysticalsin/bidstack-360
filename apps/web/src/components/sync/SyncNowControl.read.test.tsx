// A paused or in-flight sync overview has no status yet. The control said
// Never synced. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useSyncNow: vi.fn(),
}));

vi.mock('@/hooks/useSyncNow', () => ({
  useSyncNow: hookMocks.useSyncNow,
}));

import { SyncNowControl } from './SyncNowControl';

const CHECKING = 'Checking the last sync. The status has not arrived.';
const FAILED = 'Could not load the sync status.';
const NEVER = 'Never synced';
const SYNCED_AT = '2026-11-01T15:04:00.000Z';

function completedRun() {
  return {
    runId: 'dust-abc',
    source: 'dust' as const,
    state: 'completed' as const,
    progress: 100,
    startedAt: '2026-11-01T15:00:00.000Z',
    finishedAt: SYNCED_AT,
    result: { new: 1, updated: 0, skipped: 0, failed: 0 },
    reasons: [] as string[],
  };
}

function overview(lastSyncedAt: string | null, lastRun: ReturnType<typeof completedRun> | null) {
  return { source: 'dust' as const, lastSyncedAt, lastRun };
}

function renderControl(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  const data = query.data;
  const record =
    data && typeof data === 'object'
      ? (data as { lastSyncedAt?: string | null; lastRun?: unknown })
      : null;
  hookMocks.useSyncNow.mockReturnValue({
    lastSyncedAt: record?.lastSyncedAt ?? null,
    overviewLoading: query.isLoading,
    overview: {
      data: query.data,
      isError: query.isError,
      status: query.status,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
    },
    run: record?.lastRun ?? null,
    busy: false,
    startError: null,
    start: vi.fn(),
  });
  render(<SyncNowControl source="dust" />);
}

describe('SyncNowControl sync status read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused sync read as never synced', () => {
    // WHY: a paused first read has isLoading false and no overview. Never
    // synced says the status arrived. This one has not.
    renderControl({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(NEVER)).toBeNull();
    expect(screen.queryByRole('time')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight sync read as never synced', () => {
    // WHY: a slow read also has no overview, and isLoading can stay false.
    // Never synced must not stand in for a read that is still running.
    renderControl({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(NEVER)).toBeNull();
    expect(screen.queryByRole('time')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed sync read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error, and Never synced must not open.
    renderControl({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('sync down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NEVER)).toBeNull();
    expect(screen.queryByRole('time')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('lets a failed read win over a stale sync', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // last sync time or a finished run.
    renderControl({
      data: overview(SYNCED_AT, completedRun()),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('sync down'),
    });

    expect(screen.queryByRole('time')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText(NEVER)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed status win when isError is still false', () => {
    // WHY: error wins even when the flag has not flipped. A status of error
    // must not keep the stale time, and it must not look like never synced.
    renderControl({
      data: overview(SYNCED_AT, completedRun()),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'error',
      error: new Error('sync down'),
    });

    expect(screen.queryByRole('time')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText(NEVER)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays on never synced when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not still checking.
    renderControl({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(NEVER)).toBeTruthy();
    expect(screen.queryByRole('time')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('stays on never synced when a settled overview has no last sync', () => {
    // WHY: an overview with no last sync has arrived. Unread must not replace
    // that settled miss, and the miss must not say the load failed.
    renderControl({
      data: overview(null, null),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(NEVER)).toBeTruthy();
    expect(screen.queryByRole('time')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded sync time when the last run is blank', () => {
    // WHY: a loaded time stays. A blank last run is loaded data. Unread must
    // not drop the time, and the control must not invent a finished run.
    renderControl({
      data: overview(SYNCED_AT, null),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    const time = screen.getByRole('time');
    expect(time.getAttribute('dateTime')).toBe(SYNCED_AT);
    expect(time.textContent).toContain('Last synced');
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText(NEVER)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded sync time and its finished run', () => {
    // WHY: a loaded payload stays. The unread line must not replace a time
    // and a finished run the read already returned.
    renderControl({
      data: overview(SYNCED_AT, completedRun()),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    const time = screen.getByRole('time');
    expect(time.getAttribute('dateTime')).toBe(SYNCED_AT);
    expect(time.textContent).toContain('Last synced');
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.queryByText(NEVER)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
