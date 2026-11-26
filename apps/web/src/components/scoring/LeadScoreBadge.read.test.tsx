// A paused or in-flight score read has no number yet. The chip rendered
// nothing, which looks off. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

const scoreMocks = vi.hoisted(() => ({
  useLeadScore: vi.fn(),
}));

vi.mock('@/hooks/usePredictiveScore', () => ({
  useLeadScore: scoreMocks.useLeadScore,
}));

import { LeadScoreBadge } from './LeadScoreBadge';

const CHECKING = 'Checking the lead score. The score has not arrived.';
const FAILED = 'Could not load the lead score.';

function renderBadge(
  query: {
    data?: { score: number; factors: { feature: string; contribution: number }[] } | null;
    isLoading: boolean;
    isError: boolean;
    status?: string;
  },
  prefetched?: { score: number; factors: { feature: string; contribution: number }[] },
) {
  scoreMocks.useLeadScore.mockReturnValue(query);
  return render(<LeadScoreBadge leadId="lead-demo" prefetched={prefetched} />);
}

describe('LeadScoreBadge read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused score read as off', () => {
    // WHY: a paused first read has isLoading false and no score. An absent
    // chip looks off. The score has not arrived.
    renderBadge({ data: undefined, isLoading: false, isError: false, status: 'pending' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight score read as off', () => {
    // WHY: a slow read also has no score. A skeleton with no status is not
    // a settled number, and it is not a failed load.
    renderBadge({ data: undefined, isLoading: true, isError: false, status: 'pending' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed score read on the error', () => {
    // WHY: a failed read is not evidence that the lead has no score. The
    // error stays, and a missing chip does not stand in for the read.
    renderBadge({ data: undefined, isLoading: false, isError: true, status: 'error' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed read win over a stale score', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing 81 from a score that is no longer the read.
    renderBadge({
      data: { score: 81, factors: [] },
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('81')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays empty when a settled read has no score', () => {
    // WHY: a read that arrived without a score stays empty. A slow network
    // must not be dressed up as an empty score, and this one must.
    renderBadge({ data: null, isLoading: false, isError: false, status: 'success' });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows the chip when the score has arrived', () => {
    // WHY: a loaded score stays. The unread line must not replace a number
    // the read already returned.
    renderBadge({
      data: { score: 64, factors: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.getByText('64')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a settled score of zero', () => {
    // WHY: zero is a loaded score. Unread must not look like zero, and a
    // real zero must not look unread or off.
    renderBadge({
      data: { score: 0, factors: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a score the parent already loaded', () => {
    // WHY: a prefetched score is settled data. A disabled refetch must not
    // paint the checking line over that number.
    renderBadge(
      { data: undefined, isLoading: false, isError: false, status: 'pending' },
      { score: 55, factors: [] },
    );

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.getByText('55')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
