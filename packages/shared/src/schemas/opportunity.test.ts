import { describe, expect, it } from 'vitest';

import {
  Opportunity,
  OpportunityCreate,
  OpportunityFilter,
  PipelineStage,
} from './opportunity.js';

describe('PipelineStage', () => {
  it('accepts a valid pipeline stage', () => {
    const stage = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Technical Iteration',
      probability: 50,
      color: '#3b82f6',
    };
    expect(() => PipelineStage.parse(stage)).not.toThrow();
  });
});

describe('Opportunity', () => {
  const valid = {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'OP-2041',
    customer: 'CI Financial',
    name: 'CI Financial — IT Modernization',
    stage: 's1_ongoing',
    pipelineStageId: '00000000-0000-0000-0000-000000000002',
    pipelineStage: {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Technical Iteration',
      probability: 65,
      color: '#3b82f6',
    },
    value: 1_240_000,
    probability: 65,
    dueDate: '2026-07-22',
    owner: 'jane.smith@mantu.com',
    industry: 'financial_services',
    logo: null,
    country: 'CA',
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-05-10T08:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
  };

  it('parses a representative seed row', () => {
    expect(() => Opportunity.parse(valid)).not.toThrow();
  });

  it('rejects probability > 100 (can never have higher than certainty)', () => {
    expect(() => Opportunity.parse({ ...valid, probability: 101 })).toThrow();
  });

  it('accepts legacy persisted codes on read so historical records do not crash list views', () => {
    expect(() => Opportunity.parse({ ...valid, code: 'RFP-ABCD-1234' })).not.toThrow();
  });
});

describe('OpportunityCreate', () => {
  it('accepts a payload without id/updatedAt (server mints them)', () => {
    expect(() =>
      OpportunityCreate.parse({
        customer: 'X',
        name: 'X bid',
        pipelineStageId: '00000000-0000-0000-0000-000000000001',
        value: 100,
        probability: 30,
        dueDate: null,
        owner: null,
        industry: null,
        logo: null,
        country: null,
        territoryId: null,
        territoryName: null,
      }),
    ).not.toThrow();
  });

  it('rejects noncanonical supplied codes on write', () => {
    expect(() =>
      OpportunityCreate.parse({
        code: 'BID-1',
        customer: 'X',
        name: 'X bid',
        pipelineStageId: '00000000-0000-0000-0000-000000000001',
        value: 100,
        probability: 30,
        dueDate: null,
        owner: null,
        industry: null,
        logo: null,
        country: null,
        territoryId: null,
        territoryName: null,
      }),
    ).toThrow();
  });
});

describe('OpportunityFilter', () => {
  it('defaults limit to 50 and caps at 200', () => {
    expect(OpportunityFilter.parse({}).limit).toBe(50);
    expect(() => OpportunityFilter.parse({ limit: 500 })).toThrow();
  });
});
