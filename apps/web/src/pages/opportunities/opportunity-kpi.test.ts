import { describe, expect, it } from 'vitest';

import { opportunityKpiView } from './opportunity-kpi';

const portfolio = {
  opportunities: 80,
  openOpportunities: 40,
  pipelineValue: 9_000_000,
};

function row(over: { value: number; probability: number; won?: boolean; lost?: boolean }) {
  return {
    value: over.value,
    probability: over.probability,
    pipelineStage:
      over.won || over.lost
        ? { isWon: Boolean(over.won), isLost: Boolean(over.lost) }
        : null,
  };
}

describe('opportunity KPI scope', () => {
  it('keeps the server aggregate when the list is the whole book', () => {
    // WHY: a 50-row page is not the book. Unfiltered headlines stay on the summary.
    const view = opportunityKpiView({
      opps: [row({ value: 2_500, probability: 40 })],
      summary: portfolio,
      filtered: false,
    });

    expect(view.scope).toBe('portfolio');
    expect(view.cards.map((card) => card.amount)).toEqual([80, 40, 9_000_000, 1_000]);
  });

  it('counts a filtered page instead of the portfolio', () => {
    // WHY: an overdue or stage chip that still prints the whole-book pipeline
    // reads as the filtered book. Closed rows on that page are not open pipeline.
    const view = opportunityKpiView({
      opps: [
        row({ value: 2_500, probability: 40 }),
        row({ value: 9_000_000, probability: 100, won: true }),
      ],
      summary: portfolio,
      filtered: true,
    });

    expect(view.scope).toBe('page');
    expect(view.region).toBe('filtered');
    expect(view.cards.map((card) => [card.key, card.amount])).toEqual([
      ['opportunities', 2],
      ['open', 1],
      ['openPipeline', 2_500],
      ['weighted', 1_000],
    ]);
  });
});
