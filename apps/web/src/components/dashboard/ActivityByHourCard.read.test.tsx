// A paused or in-flight activity read has no log yet. The card said there
// was no activity, and the count said 0. That sentence is what a settled
// empty log already says. The log has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useActivityFeed: vi.fn(),
  useHasPermission: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: hookMocks.useHasPermission,
}));

vi.mock('@/hooks/useActivityFeed', () => ({
  useActivityFeed: hookMocks.useActivityFeed,
}));

vi.mock('@/lib/timezone', () => ({ browserTimeZone: () => 'UTC' }));

import { ActivityByHourCard } from './ActivityByHourCard';

const CHECKING = 'Checking activity by hour. The log has not arrived.';
const FAILED = 'Could not load activity.';
const EMPTY = 'No activity logged yet.';
const ZERO = '0 logged';
const LOADING = 'Loading activity.';

function item(type: string, hour: string) {
  return { id: `${type}-${hour}`, occurredAt: `2026-11-03T${hour}:15:00Z`, type };
}

function payload(items: ReturnType<typeof item>[], total = items.length) {
  return { items, total };
}

function renderCard(read: { data?: unknown; isError?: boolean; isLoading?: boolean; status?: string }) {
  hookMocks.useHasPermission.mockReturnValue(true);
  hookMocks.useActivityFeed.mockReturnValue({
    data: read.data,
    isError: read.isError ?? false,
    isLoading: read.isLoading ?? false,
    status: read.status ?? 'pending',
    error: read.isError ? new Error('activity down') : null,
    refetch: vi.fn(),
  });
  render(<ActivityByHourCard />);
}

describe('ActivityByHourCard read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused activity read as an empty log', () => {
    // WHY: a paused first read has isLoading false and no payload. "No
    // activity logged yet" is how a settled empty log looks. This one has
    // not arrived, and 0 logged is a count the read has not earned.
    renderCard({ data: undefined, isLoading: false, isError: false, status: 'pending' });

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('figure', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
  });

  it('does not treat an in-flight activity read as an empty log', () => {
    // WHY: a slow read also has no payload, and isLoading can stay false.
    // An empty log, a zero count, and a loading line must not stand in for
    // a read that is still running.
    renderCard({ data: undefined, isLoading: false, isError: false, status: 'pending' });

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('figure', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
  });

  it('keeps a failed activity read on the error', () => {
    // WHY: a failed read is not an unread pause and not an empty log.
    renderCard({ data: undefined, isLoading: false, isError: true, status: 'error' });

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('figure', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
  });

  it('lets a failed status win over a stale activity hour', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // previous hour when isError is still false.
    renderCard({
      data: payload([item('call', '09'), item('email', '09'), item('meeting', '15')]),
      isLoading: false,
      isError: false,
      status: 'error',
    });

    expect(screen.queryByText('3')).toBeNull();
    expect(screen.queryByText('3 logged')).toBeNull();
    expect(screen.queryByText('Calls')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('figure', { name: EMPTY })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
  });

  it('drops a stale activity hour when the read is in error', () => {
    // WHY: isError wins even when a previous hour is still in data.
    // That hour is not the settled log.
    renderCard({
      data: payload([item('call', '09'), item('email', '09'), item('meeting', '15')]),
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.queryByText('3')).toBeNull();
    expect(screen.queryByText('3 logged')).toBeNull();
    expect(screen.queryByText('Calls')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('figure', { name: EMPTY })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is
    // not a failed load, and it is not still checking.
    renderCard({ data: null, isLoading: false, isError: false, status: 'success' });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('stays empty when a settled log has no activity', () => {
    // WHY: a zero log has arrived. Unread must not replace that settled
    // empty log, and the zero must not say the load failed.
    renderCard({
      data: payload([]),
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText(ZERO)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a loaded hour, including a blank activity type', () => {
    // WHY: a loaded hour is the log. Unread must not drop it, and a blank
    // activity type is still a loaded row.
    renderCard({
      data: payload([item('call', '09'), item('', '09')]),
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('Calls')).toBeTruthy();
    expect(screen.getByText('Other')).toBeTruthy();
    expect(screen.getByRole('img', { name: /busiest 09 with 2/i })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
