import { describe, expect, it } from 'vitest';

import { opportunityDraftLines } from './proposals.helpers.js';

describe('opportunityDraftLines', () => {
  it('keeps a blank probability and an amount from looking measured or euro-denominated', () => {
    const lines = opportunityDraftLines({
      name: 'Ledger Refresh',
      stage: 'closed_won',
      probability: 0,
      valueMicros: 2_500_000_000_000n,
      territory: { name: 'France' },
      pipelineStage: { isWon: true, isLost: true, deletedAt: null },
    });

    expect(lines).toContain('Opportunity: Ledger Refresh');
    expect(lines).toContain('Probability: not recorded');
    expect(lines).toContain('Outcome: lost');
    expect(lines).toContain('Value: 2,500,000 (currency not recorded)');
    expect(lines).toContain('Territory: France');
    expect(lines).not.toContain('Outcome: won');
    expect(lines).not.toMatch(/0%|EUR|€/);
  });

  it('keeps a recorded probability under 40 and ignores a deleted stage flag', () => {
    const lines = opportunityDraftLines({
      name: 'Security Program',
      stage: 's2_sent',
      probability: 35,
      valueMicros: 0,
      pipelineStage: {
        isWon: false,
        isLost: true,
        deletedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    expect(lines).toContain('Probability: 35%');
    expect(lines).not.toContain('Outcome:');
    expect(lines).not.toContain('Value:');
  });
});
