import { describe, expect, it } from 'vitest';

import type { Opportunity, PipelineStage } from '@bidstack/shared';

import {
  opportunityListStageChips,
  opportunityRowStage,
  opportunityStageChipTone,
} from './opportunity-stage-chips';

// Demo columns are named Technical Iteration. The seed writes
// s3_technical_iteration and leaves pipelineStageId null (OP-2041). The list
// was drawing that legacy label as a second chip, so Technical Iteration sat
// there with no bid wearing its name.
const TECHNICAL_ITERATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUSTOM_STAGE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const catalogStage = {
  id: TECHNICAL_ITERATION,
  key: 's3_technical_iteration',
  name: 'Technical Iteration',
  probability: 65,
  color: '#06b6d4',
  isWon: false,
  isLost: false,
  orderIndex: 3,
};

function bid(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'OP-2041',
    customer: 'CI Financial',
    name: 'CI Financial IT Modernization and MSP',
    stage: 's3_technical_iteration',
    pipelineStageId: null,
    pipelineStage: null,
    value: 1_240_000,
    probability: 65,
    dueDate: '2026-07-22',
    owner: 'alex.example@example.test',
    industry: 'financial_services',
    logo: null,
    country: 'CA',
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-07-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
    ...overrides,
  };
}

describe('opportunity list stage chips', () => {
  it('uses the demo stage name once, keyed the way the seed stored the bid', () => {
    const chips = opportunityListStageChips([bid()], [catalogStage]);

    expect(chips.map((chip) => chip.name)).toEqual(['Technical Iteration']);
    expect(chips[0]?.id).toBe('s3_technical_iteration');
    expect(chips.some((chip) => chip.name === 'S3 Technical Iteration')).toBe(false);
  });

  it('does not add a second chip when the bid already points at that demo stage', () => {
    const pipelineStage: PipelineStage = {
      id: TECHNICAL_ITERATION,
      name: 'Technical Iteration',
      probability: 65,
      color: '#06b6d4',
      isWon: false,
      isLost: false,
    };
    const chips = opportunityListStageChips(
      [bid({ pipelineStageId: TECHNICAL_ITERATION, pipelineStage, stage: 'Technical Iteration' })],
      [catalogStage],
    );

    expect(chips).toHaveLength(1);
    expect(chips[0]?.id).toBe('s3_technical_iteration');
  });

  it('keeps a custom stage on its id when the key is not a seeded enum', () => {
    const chips = opportunityListStageChips([], [
      {
        id: CUSTOM_STAGE,
        key: 'partner_intro',
        name: 'Partner intro',
        probability: 10,
        color: null,
        isWon: false,
        isLost: false,
        orderIndex: 8,
      },
    ]);

    expect(chips).toEqual([
      expect.objectContaining({ id: CUSTOM_STAGE, name: 'Partner intro' }),
    ]);
  });

  it('trims a stored key before treating it as the seeded enum', () => {
    const chips = opportunityListStageChips([bid()], [
      { ...catalogStage, key: '  s3_technical_iteration  ' },
    ]);

    expect(chips[0]?.id).toBe('s3_technical_iteration');
    expect(chips.filter((chip) => chip.name === 'Technical Iteration')).toHaveLength(1);
  });

  it('keeps the legacy chip row until the stage catalog has loaded', () => {
    const chips = opportunityListStageChips([bid()], []);
    expect(chips.some((chip) => chip.id === 's3_technical_iteration')).toBe(true);
  });

  it('names the row with the demo stage the chip shows', () => {
    const chips = opportunityListStageChips([bid()], [catalogStage]);
    expect(opportunityRowStage(bid(), chips).name).toBe('Technical Iteration');
    expect(opportunityRowStage(bid(), chips).id).toBe('s3_technical_iteration');
  });
});

describe('opportunity stage chip tone', () => {
  it('colors Technical Iteration as that stage, not the empty gray fallback', () => {
    expect(
      opportunityStageChipTone({ id: 's3_technical_iteration', name: 'Technical Iteration' }),
    ).toBe('teal');
    expect(
      opportunityStageChipTone({ id: TECHNICAL_ITERATION, name: 'Technical Iteration' }),
    ).toBe('teal');
    expect(opportunityStageChipTone({ id: TECHNICAL_ITERATION, name: 'Closed Won' })).toBe('jade');
    expect(opportunityStageChipTone({ id: TECHNICAL_ITERATION, name: 'Closed Lost' })).toBe('tomato');
    expect(opportunityStageChipTone({ id: TECHNICAL_ITERATION, name: 'Not a stage' })).toBe('gray');
    expect(opportunityStageChipTone(null)).toBe('gray');
  });
});
