// A paused or in-flight pattern read has no payload, and isLoading is false
// when the fetch is paused. That is not a settled empty book. Saying "no
// loss reasons recorded yet" (or throwing on the missing payload) tells a
// reader the debrief was read and came back empty. An empty pattern is only
// honest after a payload arrives. A later failure must keep the reasons
// already on screen.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WinLossPatterns } from '@bidstack/shared';

const patternState = vi.hoisted(() => ({
  data: undefined as WinLossPatterns | undefined,
  isLoading: false,
  isError: false,
  error: null as Error | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => false,
}));

vi.mock('@/hooks/useWinLoss', () => ({
  useWinLossPatterns: () => patternState,
  useUpsertWinLoss: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { WinLossReasonsCard } from './WinLossReasonsCard';

const EMPTY: WinLossPatterns = {
  rows: [],
  totalWon: 0,
  totalLost: 0,
  topLossReason: null,
};

const PRICE_LOSS: WinLossPatterns = {
  rows: [{ reason: 'price', outcome: 'lost', count: 3 }],
  totalWon: 2,
  totalLost: 3,
  topLossReason: 'price',
};

const CHECKING = 'Checking win/loss reasons. They have not arrived.';
const EMPTY_CLAIM = /No loss reasons recorded yet/;
const REFRESH_FAILED =
  'Could not refresh win/loss reasons. The reasons already on screen stay.';

function renderCard() {
  return render(<WinLossReasonsCard closedOpps={[]} />);
}

describe('WinLossReasonsCard read honesty', () => {
  afterEach(() => {
    cleanup();
    patternState.data = undefined;
    patternState.isLoading = false;
    patternState.isError = false;
    patternState.error = null;
  });

  it('does not call a paused read an empty debrief', () => {
    patternState.data = undefined;
    patternState.isLoading = false;
    patternState.isError = false;

    renderCard();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY_CLAIM)).toBeNull();
    expect(screen.queryByText('Could not load win/loss patterns')).toBeNull();
  });

  it('does not call an in-flight read an empty debrief', () => {
    patternState.data = undefined;
    patternState.isLoading = true;
    patternState.isError = false;

    renderCard();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(EMPTY_CLAIM)).toBeNull();
  });

  it('keeps a failed read with no payload on the error', () => {
    patternState.data = undefined;
    patternState.isLoading = false;
    patternState.isError = true;
    patternState.error = new Error('patterns unavailable');

    renderCard();

    expect(screen.getByRole('alert').textContent).toContain('Could not load win/loss patterns');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY_CLAIM)).toBeNull();
  });

  it('still says the book is empty after a settled read with no reasons', () => {
    patternState.data = EMPTY;
    patternState.isLoading = false;
    patternState.isError = false;

    renderCard();

    expect(screen.getByText(EMPTY_CLAIM)).toBeTruthy();
    expect(screen.getByText('0 won · 0 lost recorded')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('shows a loss reason that has arrived', () => {
    patternState.data = PRICE_LOSS;

    renderCard();

    expect(screen.getByText('Price')).toBeTruthy();
    expect(screen.getByText('2 won · 3 lost recorded')).toBeTruthy();
    expect(screen.queryByText(EMPTY_CLAIM)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('keeps a loaded reason when a later read fails', () => {
    patternState.data = PRICE_LOSS;
    patternState.isError = true;
    patternState.error = new Error('refresh failed');

    renderCard();

    expect(screen.getByText('Price')).toBeTruthy();
    expect(screen.getByText('2 won · 3 lost recorded')).toBeTruthy();
    expect(screen.getByText(REFRESH_FAILED)).toBeTruthy();
    expect(screen.queryByText('Could not load win/loss patterns')).toBeNull();
    expect(screen.queryByText(EMPTY_CLAIM)).toBeNull();
  });
});
