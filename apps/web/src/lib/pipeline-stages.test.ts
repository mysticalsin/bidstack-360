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

  it('files an enum-only demo bid in the short-named column and does not open a second one', () => {
    // WHY: the demo book names the column Technical Iteration and keeps the
    // key s3_technical_iteration. Siemens is seeded with that enum and no
    // pipeline stage row. Matching the display name files the bid into a
    // duplicate S3 Technical Iteration column and leaves Technical Iteration
    // empty. A bid that already points at the column id must stay on that
    // one column too.
    const technical: PipelineStage & { key: string } = {
      id: '44444444-4444-4444-8444-444444444444',
      key: 's3_technical_iteration',
      name: 'Technical Iteration',
      probability: 65,
      color: '#06b6d4',
      isWon: false,
      isLost: false,
    };
    const negotiation: PipelineStage & { key: string } = {
      id: '55555555-5555-4555-8555-555555555555',
      key: 's4_negotiation',
      name: 'Negotiation',
      probability: 80,
      color: '#f59e0b',
      isWon: false,
      isLost: false,
    };
    const siemens: Opportunity = {
      ...baseOpportunity,
      id: '88888888-8888-4888-8888-888888888888',
      code: 'OP-0001',
      customer: 'Siemens',
      name: 'Global ERP Modernization',
      stage: 's3_technical_iteration',
      pipelineStageId: null,
      pipelineStage: null,
      value: 1_200_000,
    };
    const ikeaStage: PipelineStage = {
      id: negotiation.id,
      name: negotiation.name,
      probability: negotiation.probability,
      color: negotiation.color,
      isWon: false,
      isLost: false,
    };
    const ikea: Opportunity = {
      ...baseOpportunity,
      id: '99999999-9999-4999-8999-999999999999',
      code: 'OP-0002',
      customer: 'IKEA',
      name: 'Cloud Migration & FinOps',
      stage: 'Negotiation',
      pipelineStageId: negotiation.id,
      pipelineStage: ikeaStage,
      value: 850_000,
    };

    const stages = getPipelineStages([siemens, ikea], [technical, negotiation]);

    expect(getPipelineStageBusinessKey(technical)).toBe('s3_technical_iteration');
    expect(getOpportunityStageBusinessKey(siemens)).toBe('s3_technical_iteration');
    expect(stages.map((stage) => stage.name)).toEqual(['Technical Iteration', 'Negotiation']);
    expect(stages.map((stage) => stage.id)).toEqual([technical.id, negotiation.id]);
  });
});
