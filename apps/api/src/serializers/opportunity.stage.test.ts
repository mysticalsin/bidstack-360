import { describe, expect, it } from 'vitest';

import { serializeOpportunity } from './opportunity.js';

const base = {
  id: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5b',
  code: 'OP-2042',
  customer: 'Acme',
  companyId: null,
  name: 'Back in play',
  stage: 's2_sent' as const,
  pipelineStageId: 'stage-1',
  valueMicros: 2_000_000n,
  probability: 40,
  dueDate: null,
  industry: null,
  logoUrl: null,
  country: null,
  territoryId: null,
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  viewCount: 0,
  owner: null,
};

describe('serializeOpportunity stage', () => {
  it('drops a deleted stage so its lost flag is not the deal', () => {
    // WHY: the list was still named and flagged from a stage row that had
    // been deleted, so the board kept the bid closed.
    const deal = serializeOpportunity({
      ...base,
      pipelineStage: {
        id: 'stage-1',
        name: 'Price lost',
        probability: 0,
        color: null,
        isWon: false,
        isLost: true,
        deletedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });
    expect(deal.stage).toBe('s2_sent');
    expect(deal.pipelineStage).toBeNull();
  });

  it('keeps a live lost flag on the deal', () => {
    const deal = serializeOpportunity({
      ...base,
      pipelineStage: {
        id: 'stage-1',
        name: 'Price lost',
        probability: 0,
        color: null,
        isWon: false,
        isLost: true,
        deletedAt: null,
      },
    });
    expect(deal.stage).toBe('Price lost');
    expect(deal.pipelineStage?.isLost).toBe(true);
  });
});
