import { describe, expect, it } from 'vitest';

import {
  Opportunity,
  OpportunityCreate,
  OpportunityFilter,
  OpportunityStage,
} from './opportunity.js';

describe('OpportunityStage', () => {
  it('accepts every canonical stage', () => {
    for (const s of [
      's1_lead',
      's1_ongoing',
      's2_sent',
      's3_technical_iteration',
      's4_negotiation',
      'closed_won',
      'closed_lost',
    ]) {
      expect(() => OpportunityStage.parse(s)).not.toThrow();
    }
  });

  it('rejects prototype-era stage names ("won"/"lost") — they must be normalized at the seed layer', () => {
    // Why: the prototype data.js used "qualifying"/"won"/"lost"; we standardize
    // on the SPEC enum so REST + MCP + DB all share one vocabulary.
    expect(() => OpportunityStage.parse('won')).toThrow();
    expect(() => OpportunityStage.parse('lost')).toThrow();
    expect(() => OpportunityStage.parse('qualifying')).toThrow();
  });
});

describe('Opportunity', () => {
  const valid = {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'OP-2041',
    customer: 'CI Financial',
    name: 'CI Financial — IT Modernization',
    stage: 's3_technical_iteration',
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
  };

  it('parses a representative seed row', () => {
    expect(() => Opportunity.parse(valid)).not.toThrow();
  });

  it('rejects probability > 100 (can never have higher than certainty)', () => {
    expect(() => Opportunity.parse({ ...valid, probability: 101 })).toThrow();
  });

  it('rejects code that does not match OP-NNNN — codes are externally communicated bid identifiers', () => {
    expect(() => Opportunity.parse({ ...valid, code: 'BID-1' })).toThrow();
  });
});

describe('OpportunityCreate', () => {
  it('accepts a payload without id/updatedAt (server mints them)', () => {
    expect(() =>
      OpportunityCreate.parse({
        customer: 'X',
        name: 'X bid',
        stage: 's1_ongoing',
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
});

describe('OpportunityFilter', () => {
  it('defaults limit to 50 and caps at 200', () => {
    expect(OpportunityFilter.parse({}).limit).toBe(50);
    expect(() => OpportunityFilter.parse({ limit: 500 })).toThrow();
  });
});
