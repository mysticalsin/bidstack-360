// A paused or in-flight probability read has no number yet. The chip rendered
// nothing, which looks off. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

const scoreMocks = vi.hoisted(() => ({
  useOppScore: vi.fn(),
}));

vi.mock('@/hooks/usePredictiveScore', () => ({
  useOppScore: scoreMocks.useOppScore,
}));

import { OppWinProbabilityBadge } from './OppWinProbabilityBadge';

const CHECKING = 'Checking the win probability. The probability has not arrived.';
const FAILED = 'Could not load the win probability.';

function renderBadge(
  query: {
    data?: { winProbability: number; factors: { feature: string; contribution: number }[]; recommendation?: string } | null;
    isLoading: boolean;
    isError: boolean;
    status?: string;
  },
  prefetched?: { winProbability: number; factors: { feature: string; contribution: number }[] },
) {
  scoreMocks.useOppScore.mockReturnValue(query);
  return render(<OppWinProbabilityBadge oppId="opp-demo" prefetched={prefetched} />);
}

describe('OppWinProbabilityBadge read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused probability read as off', () => {
    // WHY: a paused first read has isLoading false and no probability. An
    // absent chip looks off. The probability has not arrived.
    renderBadge({ data: undefined, isLoading: false, isError: false, status: 'pending' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight probability read as off', () => {
    // WHY: a slow read also has no probability. A skeleton with no status is
    // not a settled number, and it is not a failed load.
    renderBadge({ data: undefined, isLoading: true, isError: false, status: 'pending' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed probability read on the error', () => {
    // WHY: a failed read is not evidence that the opportunity has no
    // probability. The error stays, and a missing chip does not stand in
    // for the read.
    renderBadge({ data: undefined, isLoading: false, isError: true, status: 'error' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed read win over a stale probability', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing 81% from a probability that is no longer the read.
    renderBadge({
      data: { winProbability: 81, factors: [], recommendation: 'Push' },
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('81%')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays empty when a settled read has no probability', () => {
    // WHY: a read that arrived without a probability stays empty. A slow
    // network must not be dressed up as an empty probability, and this one
    // must.
    renderBadge({ data: null, isLoading: false, isError: false, status: 'success' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows the chip when the probability has arrived', () => {
    // WHY: a loaded probability stays. The unread line must not replace a
    // number the read already returned.
    renderBadge({
      data: { winProbability: 64, factors: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.getByText('64%')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a settled probability of zero', () => {
    // WHY: zero is a loaded probability. Unread must not look like zero, and
    // a real zero must not look unread or off.
    renderBadge({
      data: { winProbability: 0, factors: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a probability the parent already loaded', () => {
    // WHY: a prefetched probability is settled data. A disabled refetch must
    // not paint the checking line over that number.
    renderBadge(
      { data: undefined, isLoading: false, isError: false, status: 'pending' },
      { winProbability: 55, factors: [] },
    );

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.getByText('55%')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
