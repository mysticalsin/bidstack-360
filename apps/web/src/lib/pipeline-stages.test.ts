import { describe, expect, it } from 'vitest';

import {
  getOpportunityStageBusinessKey,
  getPipelineStageBusinessKey,
  getPipelineStages,
} from './pipeline-stages';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

const s2Canonical: PipelineStage = {
  id: '9124dff3-f67b-46c7-abae-4f938666884a',
  name: 'S2 Sent',
  probability: 40,
  color: '#06b6d4',
  isWon: false,
  isLost: false,
};

const baseOpportunity: Opportunity = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'OP-1234',
  customer: 'Acme',
  name: 'Enterprise rollout',
  stage: 's1_lead',
  pipelineStageId: null,
  pipelineStage: null,
  value: 100_000,
  probability: 20,
  dueDate: null,
  owner: null,
  industry: null,
  logo: null,
  country: 'US',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-03T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

describe('pipeline stage normalization', () => {
  it('keeps configured empty stages instead of deriving columns only from current cards', () => {
    const s1Canonical: PipelineStage = {
      id: '7124dff3-f67b-46c7-abae-4f938666884a',
      name: 'S1 Lead',
      probability: 10,
      color: '#3b82f6',
      isWon: false,
      isLost: false,
    };
    const s1OngoingCanonical: PipelineStage = {
      id: '8124dff3-f67b-46c7-abae-4f938666884a',
      name: 'S1 Ongoing',
      probability: 25,
      color: '#6366f1',
      isWon: false,
      isLost: false,
    };
    const s2CanonicalOpp: Opportunity = {
      ...baseOpportunity,
      id: '44444444-4444-4444-8444-444444444444',
      code: 'OP-4444',
      stage: 'S2 Sent',
      pipelineStageId: s2Canonical.id,
      pipelineStage: s2Canonical,
    };

    const stages = getPipelineStages(
      [s2CanonicalOpp],
      [s1Canonical, s1OngoingCanonical, s2Canonical],
    );

    expect(stages.map((stage) => stage.name)).toEqual(['S1 Lead', 'S1 Ongoing', 'S2 Sent']);
  });

  it('deduplicates legacy and canonical versions of the same business stage', () => {
    const legacyS2: Opportunity = {
      ...baseOpportunity,
      id: '22222222-2222-4222-8222-222222222222',
      code: 'OP-2222',
      stage: 's2_sent',
    };
    const canonicalS2: Opportunity = {
      ...baseOpportunity,
      id: '33333333-3333-4333-8333-333333333333',
      code: 'OP-3333',
      stage: 'S2 Sent',
      pipelineStageId: s2Canonical.id,
      pipelineStage: s2Canonical,
    };

    const stages = getPipelineStages([legacyS2, canonicalS2]);
    const s2Stages = stages.filter((stage) => stage.name === 'S2 Sent');

    expect(s2Stages).toHaveLength(1);
    expect(s2Stages[0].id).toBe(s2Canonical.id);
    expect(getPipelineStageBusinessKey(s2Stages[0])).toBe('s2_sent');
    expect(getOpportunityStageBusinessKey(legacyS2)).toBe('s2_sent');
    expect(getOpportunityStageBusinessKey(canonicalS2)).toBe('s2_sent');
  });

  it('files a closed bid titled Closed Won in the demo column, not a second one', () => {
    // WHY: the demo column is already named Closed Won. A bid whose stage
    // text is that title (the label formatStage prints, and the value a
    // legacy-column move stores) is not the enum closed_won. Leaving it
    // unmatched opens a second Closed Won column and the real one stays empty.
    const closedWon: PipelineStage = {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Closed Won',
      probability: 100,
      color: '#22c55e',
      isWon: true,
      isLost: false,
    };
    const closedLost: PipelineStage = {
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Closed Lost',
      probability: 0,
      color: '#ef4444',
      isWon: false,
      isLost: true,
    };
    const stellantis: Opportunity = {
      ...baseOpportunity,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      code: 'OP-0005',
      customer: 'Stellantis',
      name: 'EV Fleet Telematics',
      stage: 'Closed Won',
      pipelineStageId: null,
      pipelineStage: null,
      value: 620_000,
    };
    const spotify: Opportunity = {
      ...baseOpportunity,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      code: 'OP-0006',
      customer: 'Spotify',
      name: 'Data Lakehouse Build',
      stage: 'Closed Lost',
      pipelineStageId: null,
      pipelineStage: null,
      value: 430_000,
    };

    const stages = getPipelineStages([stellantis, spotify], [closedWon, closedLost]);

    expect(getOpportunityStageBusinessKey(stellantis)).toBe('closed_won');
    expect(getOpportunityStageBusinessKey(spotify)).toBe('closed_lost');
    expect(stages.map((stage) => stage.id)).toEqual([closedWon.id, closedLost.id]);
    expect(stages.map((stage) => stage.name)).toEqual(['Closed Won', 'Closed Lost']);
  });
});
