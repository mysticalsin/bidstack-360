// A paused or in-flight bid score has no row yet. The opportunity card used
// the same "no score recorded" line as a settled 404, and offered Evaluate
// Now. 61520 is the score that would have been on the bid. It must not
// appear, and it must not collapse to 0, until that payload arrives.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { BidScoreCard } from './BidScoreCard';
import { useBidScoreLatest } from '@/hooks/useBidScore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useBidScore', () => ({
  useBidScoreLatest: vi.fn(),
}));

const EMPTY = 'No bid evaluation score has been recorded for this opportunity yet.';
const CHECKING = 'Checking the bid score';
const NOT_ARRIVED = 'The score has not arrived.';
const LOAD_ERROR = 'Could not load the bid score. Refresh to try again.';
const SCORE = '61520%';
const ZERO = '0%';

const LOADED = {
  totalScore: 61520,
  recommendation: 'bid' as const,
  criteria: {},
  categoryScores: {},
  overrideJustification: null,
};

function mockScore(value: Record<string, unknown>) {
  vi.mocked(useBidScoreLatest).mockReturnValue(value as ReturnType<typeof useBidScoreLatest>);
}

function renderCard() {
  return render(
    <MemoryRouter>
      <BidScoreCard opportunityId="opp-northwind" />
    </MemoryRouter>,
  );
}

describe('BidScoreCard read honesty', () => {
  afterEach(() => cleanup());

  it('does not call a paused score read an unscored bid', () => {
    // WHY: isLoading is false while the first read is paused, so the card
    // said no score was recorded and offered Evaluate Now for 61520.
    mockScore({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
      status: 'pending',
      fetchStatus: 'paused',
    });

    renderCard();

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Evaluate Now' })).toBeNull();
    expect(screen.queryByText(SCORE)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.getByRole('status').textContent).toContain(NOT_ARRIVED);
  });

  it('does not call an in-flight score read an unscored bid', () => {
    mockScore({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      error: null,
      status: 'pending',
      fetchStatus: 'fetching',
    });

    renderCard();

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Evaluate Now' })).toBeNull();
    expect(screen.queryByText(SCORE)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.getByRole('status').textContent).toContain(NOT_ARRIVED);
  });

  it('keeps a failed score read on the error, not on an empty bid', () => {
    mockScore({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: new Error('score down'),
      status: 'error',
      fetchStatus: 'idle',
    });

    renderCard();

    expect(screen.getByText(LOAD_ERROR)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Evaluate Now' })).toBeNull();
    expect(screen.queryByText(SCORE)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says the bid has no score after a 404', () => {
    mockScore({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: { status: 404 },
      status: 'error',
      fetchStatus: 'idle',
    });

    renderCard();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Evaluate Now' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
    expect(screen.queryByText(SCORE)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
  });

  it('still says the bid has no score after a settled read with no row', () => {
    mockScore({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
    });

    renderCard();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Evaluate Now' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(SCORE)).toBeNull();
  });

  it('still shows 61520 once the score payload has arrived', () => {
    mockScore({
      data: LOADED,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
    });

    renderCard();

    expect(screen.getByText(SCORE)).toBeTruthy();
    expect(screen.getByText('Bid')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(ZERO)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Evaluate Now' })).toBeNull();
  });
});
