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

  it('keeps a large amount on the exact cent', () => {
    const lines = opportunityDraftLines({
      name: 'Wide book',
      stage: 's1_lead',
      probability: 40,
      valueMicros: 8_598_204_328_457_184_962n,
    });

    expect(lines).toContain('Value: 8,598,204,328,457.18 (currency not recorded)');
    expect(lines).not.toContain('8,598,204,328,457.19');
  });
});
