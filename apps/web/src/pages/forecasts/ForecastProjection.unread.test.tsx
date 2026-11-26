// A paused or in-flight weighted projection has no payload yet. The card
// used the same "No open pipeline to forecast" line as a settled empty
// book, which tells the reader the pipeline is available and empty.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForecastProjection } from './ForecastProjection';

const projection = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/hooks/useForecasts', () => ({ useForecastProjection: () => projection.result }));
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ formatMoneyMicros: (m: number) => `R$${m / 1e6}` }),
}));

afterEach(cleanup);

const EMPTY = 'No open pipeline to forecast';
const CHECKING = 'Checking the weighted pipeline';
const NOT_ARRIVED = 'The projection has not arrived.';
const LOAD_ERROR = 'Failed to load projection';

const period = (label: string, open: number, weighted: number, won: number) => ({
  period: label,
  label,
  openMicros: open * 1e6,
  weightedMicros: weighted * 1e6,
  wonMicros: won * 1e6,
  manualCommitMicros: null,
  byOwner: [],
});

function show(result: Record<string, unknown>) {
  projection.result = result as typeof projection.result;
  render(<ForecastProjection />);
}

describe('ForecastProjection unread read', () => {
  it('does not call a paused projection an empty pipeline', () => {
    show({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
      status: 'pending',
      fetchStatus: 'paused',
      refetch: vi.fn(),
    });

    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(/^R\$0$/)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.getByRole('status').textContent).toContain(NOT_ARRIVED);
  });

  it('does not call an in-flight projection an empty pipeline', () => {
    show({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      error: null,
      status: 'pending',
      fetchStatus: 'fetching',
      refetch: vi.fn(),
    });

    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(/^R\$0$/)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.getByRole('status').textContent).toContain(NOT_ARRIVED);
  });

  it('keeps a failed projection on the error, not on an empty pipeline', () => {
    show({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: new Error('projection down'),
      status: 'error',
      fetchStatus: 'idle',
      refetch: vi.fn(),
    });

    expect(screen.getByRole('heading', { name: LOAD_ERROR })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(/^R\$0$/)).toBeNull();
  });

  it('still says there is no open pipeline after a settled empty projection', () => {
    show({
      data: { periods: [period('Q4 2026', 0, 0, 0)] },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
      refetch: vi.fn(),
    });

    expect(screen.getByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NOT_ARRIVED)).toBeNull();
  });

  it('still shows the weighted book once the projection has arrived', () => {
    show({
      data: { periods: [period('Q4 2026', 73_000_000, 39_100_000, 0)] },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
      refetch: vi.fn(),
    });

    expect(screen.getByRole('group', { name: /projection by quarter/i })).toBeTruthy();
    expect(screen.getByText('R$39100000')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});
