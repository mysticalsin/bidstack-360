// WHY: the opportunities strip's page figures are what a rep reads as "still
// to win". A decided bid left in that math overstates the book. Demo seed
// writes the outcome on the legacy stage (Stellantis closed_won, 620,000 at
// 100%) with no pipelineStage row.
import { describe, expect, it } from 'vitest';
import type { Opportunity } from '@bidstack/shared';

import { openPagePipelineValue, weightedOpenPageValue } from './open-page-weight';

const OPEN: Opportunity = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'OP-0001',
  customer: 'Siemens',
  name: 'Global ERP Modernization',
  stage: 's3_technical_iteration',
  pipelineStageId: null,
  pipelineStage: null,
  value: 1_200_000,
  probability: 60,
  dueDate: null,
  owner: null,
  industry: null,
  logo: null,
  country: null,
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-11-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

describe('open page weight', () => {
  it('drops a legacy closed-won bid from weighted and open value', () => {
    const won: Opportunity = {
      ...OPEN,
      id: '22222222-2222-4222-8222-222222222222',
      code: 'OP-0005',
      customer: 'Stellantis',
      name: 'EV Fleet Telematics',
      stage: 'closed_won',
      value: 620_000,
      probability: 100,
    };

    expect(weightedOpenPageValue([OPEN, won])).toBe(720_000);
    expect(openPagePipelineValue([OPEN, won])).toBe(1_200_000);
  });

  it('drops a legacy closed-lost bid from open value even when probability is 0', () => {
    const lost: Opportunity = {
      ...OPEN,
      id: '33333333-3333-4333-8333-333333333333',
      code: 'OP-0006',
      customer: 'Spotify',
      name: 'Data Lakehouse Build',
      stage: 'closed_lost',
      value: 430_000,
      probability: 0,
    };

    expect(weightedOpenPageValue([OPEN, lost])).toBe(720_000);
    expect(openPagePipelineValue([OPEN, lost])).toBe(1_200_000);
  });

  it('trusts a pipeline stage won flag over a stale open stage string', () => {
    const flagged: Opportunity = {
      ...OPEN,
      pipelineStageId: '44444444-4444-4444-8444-444444444444',
      pipelineStage: {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Closed Won',
        probability: 100,
        color: null,
        isWon: true,
        isLost: false,
      },
    };

    expect(weightedOpenPageValue([flagged])).toBe(0);
    expect(openPagePipelineValue([flagged])).toBe(0);
  });
});
