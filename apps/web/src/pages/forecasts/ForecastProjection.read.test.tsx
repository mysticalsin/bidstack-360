// A paused or in-flight projection read has no periods yet. The card said
// there was no open pipeline. That sentence is what a settled empty book
// already says. The projection has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useForecastProjection: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/useForecasts', () => ({
  useForecastProjection: hookMocks.useForecastProjection,
}));

import { ForecastProjection } from './ForecastProjection';

const CHECKING = 'Checking the weighted pipeline. The projection has not arrived.';
const FAILED = 'Failed to load projection';
const EMPTY = 'No open pipeline to forecast';
const NAMED = 'Ada Projection';
const STALE = 'Stale Projection';

function owner(name: string) {
  return {
    ownerId: name === '' ? null : '11111111-1111-4111-8111-111111111111',
    ownerName: name,
    openMicros: 2_000_000,
    weightedMicros: 1_000_000,
    wonMicros: 0,
  };
}

function period(overrides: Record<string, unknown> = {}) {
  return {
    period: '2026-Q4',
    label: 'Q4 2026',
    openMicros: 2_000_000,
    weightedMicros: 1_000_000,
    wonMicros: 0,
    manualCommitMicros: null,
    byOwner: [owner(NAMED)],
    ...overrides,
  };
}

function payload(periods: ReturnType<typeof period>[]) {
  return {
    currency: 'EUR',
    generatedAt: '2026-11-26T15:00:00.000Z',
    periods,
  };
}

function renderProjection(read: { data?: unknown; isError?: boolean; status?: string }) {
  hookMocks.useForecastProjection.mockReturnValue({
    data: read.data,
    isError: read.isError ?? false,
    isLoading: false,
    status: read.status ?? 'pending',
    error: read.isError ? new Error('projection down') : null,
    refetch: vi.fn(),
  });
  render(<ForecastProjection />);
}

describe('ForecastProjection read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused projection read as an empty pipeline', () => {
    // WHY: a paused first read has isLoading false and no payload. "No open
    // pipeline" is how a settled empty book looks. This one has not arrived.
    renderProjection({ data: undefined, isError: false, status: 'pending' });

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText('Q4 2026')).toBeNull();
    expect(screen.queryByText(NAMED)).toBeNull();
  });

  it('does not treat an in-flight projection read as an empty pipeline', () => {
    // WHY: a slow read also has no payload, and isLoading can stay false.
    // An empty book must not stand in for a read that is still running.
    renderProjection({ data: undefined, isError: false, status: 'pending' });

    expect(screen.getByRole('status').textContent).toBe(CHECKING);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText('Projection by quarter')).toBeNull();
  });

  it('keeps a failed projection read on the error', () => {
    // WHY: a failed read is not an unread pause and not an empty pipeline.
    renderProjection({ data: undefined, isError: true, status: 'error' });

    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(NAMED)).toBeNull();
  });

  it('lets a failed status win over a stale projection', () => {
    // WHY: error wins before a payload. A refetch failure must not keep the
    // previous quarter when isError is still false.
    renderProjection({
      data: payload([period({ byOwner: [owner(STALE)] })]),
      isError: false,
      status: 'error',
    });

    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.queryByText('Q4 2026')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('drops a stale projection when the read is in error', () => {
    // WHY: isError wins even when a previous quarter is still in data.
    // That quarter is not the settled projection.
    renderProjection({
      data: payload([period({ byOwner: [owner(STALE)] })]),
      isError: true,
      status: 'error',
    });

    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.queryByText('Q4 2026')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is
    // not a failed load, and it is not still checking.
    renderProjection({ data: null, isError: false, status: 'success' });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('stays empty when a settled projection has no pipeline', () => {
    // WHY: a zero book has arrived. Unread must not replace that settled
    // empty book, and the zero must not say the load failed.
    renderProjection({
      data: payload([
        period({
          openMicros: 0,
          weightedMicros: 0,
          wonMicros: 0,
          byOwner: [],
        }),
      ]),
      isError: false,
      status: 'success',
    });

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText(NAMED)).toBeNull();
  });

  it('shows a loaded projection, including a blank owner name', () => {
    // WHY: a loaded quarter is the projection. Unread must not drop it, and
    // a blank owner name is still a loaded row.
    renderProjection({
      data: payload([
        period({
          byOwner: [owner(''), owner(NAMED)],
        }),
      ]),
      isError: false,
      status: 'success',
    });

    expect(screen.getByText(NAMED)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Q4 2026' })).toBeTruthy();
    const ownerCells = screen.getAllByRole('cell');
    expect(ownerCells.some((cell) => cell.textContent === '')).toBe(true);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText(STALE)).toBeNull();
  });
});
