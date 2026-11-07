import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntelPayload } from '@bidstack/shared';

import { BidScoreCard } from './BidScoreCard';
import { WinPredictionCard } from './IntelCards';

const score = vi.hoisted(() => ({
  result: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      values ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? '')) : fallback,
  }),
}));
vi.mock('@/hooks/useBidScore', () => ({ useBidScoreLatest: () => score.result }));

afterEach(cleanup);

const intel = {
  winPrediction: {
    probability: 65,
    modelVersion: 'wp-baseline-0.1',
    drivers: [
      { label: 'Champion strength', contribution: 18 },
      { label: 'Pricing competitiveness', contribution: 15 },
      { label: 'Recent funding', contribution: 9 },
      { label: 'Incumbent risk', contribution: -12 },
      { label: 'Long deal cycle', contribution: -8 },
    ],
  },
} as unknown as IntelPayload;

describe('WinPredictionCard', () => {
  it('keeps the probability and draws the factors as diverging bars', () => {
    const { container } = render(<WinPredictionCard intel={intel} />);
    expect(screen.getByText('65%')).toBeTruthy();
    expect(screen.getByRole('group', { name: /win drivers/i })).toBeTruthy();
    expect(container.querySelector('[aria-label="Champion strength: +18"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Long deal cycle: -8"]')).toBeTruthy();
  });
});

describe('BidScoreCard', () => {
  const renderCard = () =>
    render(
      <MemoryRouter>
        <BidScoreCard opportunityId="opp-1" />
      </MemoryRouter>,
    );

  it('draws the evaluated criteria against the go threshold', () => {
    score.result = {
      data: {
        totalScore: 68,
        recommendation: 'proceed_with_caution',
        criteria: { strategic_fit: 4, relationship: 3, competitive: 3, deal_size: 5, timeline_risk: 2 },
        categoryScores: { strategic: 68 },
        overrideJustification: null,
      },
      isLoading: false,
      isError: false,
      error: null,
    };
    renderCard();
    expect(screen.getByText('68%')).toBeTruthy();
    expect(screen.getByRole('group', { name: /bid criteria/i })).toBeTruthy();
    expect(screen.getByRole('img', { name: /strongest on deal size/i })).toBeTruthy();
    expect(screen.getAllByText('Go threshold').length).toBeGreaterThan(0);
  });

  it('keeps Evaluate Now when the bid has not been scored', () => {
    score.result = { data: undefined, isLoading: false, isError: true, error: { status: 404 } };
    renderCard();
    expect(screen.getByRole('button', { name: 'Evaluate Now' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: /bid criteria/i })).toBeNull();
  });
});
