import { describe, expect, it } from 'vitest';

import { applyOpportunityCalibration } from './bid-scores.reasoning.js';

const base = { relationship: 3, deal_size: 3 };

describe('applyOpportunityCalibration', () => {
  it('does not treat a stored zero as a measured chance or a euro amount', () => {
    const result = applyOpportunityCalibration(base, {
      stage: 's1_lead',
      probability: 0,
      valueMicros: 2_000_000n,
    });

    expect(result.criteria.relationship).toBe(3);
    expect(result.criteria.deal_size).toBe(3);
    expect(result.line).toContain('probability: not recorded');
    expect(result.line).toContain('outcome: open');
    expect(result.line).not.toMatch(/0%|EUR|€/);
  });

  it('does not boost a lost deal, and lost wins when both flags are set', () => {
    const result = applyOpportunityCalibration(base, {
      stage: 'closed_won',
      probability: 80,
      valueMicros: 11_000_000_000_000n,
      pipelineStage: { isWon: true, isLost: true, deletedAt: null },
    });

    expect(result.criteria.relationship).toBe(3);
    expect(result.criteria.deal_size).toBe(5);
    expect(result.line).toContain('outcome: lost');
    expect(result.line).toContain('probability: 80%');
  });

  it('ignores flags on a deleted stage and keeps a recorded chance under 40', () => {
    const result = applyOpportunityCalibration(base, {
      stage: 's2_sent',
      probability: 35,
      valueMicros: 1n,
      pipelineStage: {
        isWon: false,
        isLost: true,
        deletedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    expect(result.criteria.relationship).toBe(3);
    expect(result.line).toContain('outcome: open');
    expect(result.line).toContain('probability: 35%');
  });
});
