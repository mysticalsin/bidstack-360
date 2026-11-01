import { describe, expect, it } from 'vitest';

import { buildOpportunityBrief, estimateBriefTokens } from './opportunities.brief.js';

describe('buildOpportunityBrief', () => {
  it('builds a source-grounded opportunity brief without stub copy', () => {
    const brief = buildOpportunityBrief({
      opportunity: {
        code: 'OP-3001',
        customer: 'Acme Bank',
        name: 'Payments Modernization',
        stage: 's2_sent',
        pipelineStageName: 'S2 Sent',
        valueMicros: 1_250_000_000_000n,
        probability: 62,
        dueDate: new Date('2026-07-10T00:00:00.000Z'),
        industry: 'Financial Services',
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      tasks: [
        {
          title: 'Validate margin model',
          status: 'open',
          dueDate: new Date('2026-06-12T00:00:00.000Z'),
        },
      ],
      contacts: [
        {
          name: 'Avery Sponsor',
          role: 'CIO',
          influence: 5,
          sentiment: 'warm',
          aiOptOut: false,
        },
      ],
      notes: [
        {
          title: 'Discovery recap',
          bodyMd: 'Customer wants an executive-safe migration path.',
          pinned: true,
          updatedAt: new Date('2026-06-05T12:00:00.000Z'),
        },
      ],
    });

    expect(brief).toContain('Source-grounded account brief');
    expect(brief).toContain('Payments Modernization');
    expect(brief).toContain('unspecified');
    expect(brief).toContain('stored probability of 62%');
    expect(brief).toContain('influence 5/5');
    expect(brief).not.toMatch(/stage proxy|\/100/);
    expect(brief).not.toMatch(/win probability/i);
    expect(brief).not.toMatch(/EUR|€/);
    expect(brief).toContain('Validate margin model');
    expect(brief).toContain('Avery Sponsor');
    expect(brief).not.toMatch(/stub|DUST_API_KEY|DUST_AGENT_EXEC_BRIEF/i);
    expect(estimateBriefTokens(brief)).toBeGreaterThan(50);
  });

  it('redacts opted-out stakeholder names', () => {
    const brief = buildOpportunityBrief({
      opportunity: {
        code: 'OP-3002',
        customer: 'Confidential Health',
        name: 'Security Program',
        stage: 's1_ongoing',
        pipelineStageName: null,
        valueMicros: 400_000_000_000n,
        probability: 35,
        dueDate: null,
        industry: 'financial_services',
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      tasks: [],
      contacts: [
        {
          name: 'Private Counsel',
          role: 'General Counsel',
          influence: 75,
          sentiment: 'neutral',
          aiOptOut: true,
        },
      ],
      notes: [],
    });

    expect(brief).toContain('Opted-out stakeholder (PII withheld)');
    expect(brief).not.toContain('Private Counsel');
    expect(brief).not.toContain('General Counsel');
    expect(brief).toContain('stored probability is below 40, so challenge bid/no-bid before drafting');
    expect(brief).toContain('is pursuing');
    expect(brief).toContain('S1 Ongoing');
    expect(brief).not.toContain('s1_ongoing');
    expect(brief).toContain('Financial Services');
    expect(brief).not.toContain('financial_services');
    expect(brief).not.toMatch(/win probability/i);
  });

  it('does not treat a stored zero as a measured chance below 40', () => {
    const brief = buildOpportunityBrief({
      opportunity: {
        code: 'OP-3003',
        customer: 'Northwind',
        name: 'Ledger Refresh',
        stage: 's1_lead',
        pipelineStageName: 'Lead',
        valueMicros: 2_000_000n,
        probability: 0,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        industry: null,
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      tasks: [
        {
          title: 'Confirm scope',
          status: 'open',
          dueDate: new Date('2026-06-20T00:00:00.000Z'),
        },
      ],
      contacts: [
        {
          name: 'Casey Buyer',
          role: null,
          influence: null,
          sentiment: null,
          aiOptOut: false,
        },
      ],
      notes: [],
    });

    expect(brief).toContain('no probability is recorded');
    expect(brief).toContain('**Stored probability:** not recorded');
    expect(brief).not.toContain('below 40');
    expect(brief).not.toMatch(/probability of 0%|\*\* 0%/);
    expect(brief).not.toMatch(/win probability/i);
    expect(brief).toContain('is pursuing');
  });

  it('keeps a large amount on the exact cent in the compact figure', () => {
    const brief = buildOpportunityBrief({
      opportunity: {
        code: 'OP-3006',
        customer: 'Northwind',
        name: 'Wide book',
        stage: 's1_lead',
        pipelineStageName: 'Lead',
        valueMicros: 8_598_204_328_457_184_962n,
        probability: 40,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        industry: null,
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      tasks: [],
      contacts: [],
      notes: [],
    });

    expect(brief).toContain('8,598,204,328,457.18 unspecified');
    expect(brief).not.toContain('8457.19');
    expect(brief).not.toMatch(/EUR|€/);
  });

  it('names a both-flagged live stage as lost', () => {
    const brief = buildOpportunityBrief({
      opportunity: {
        code: 'OP-3004',
        customer: 'Contoso',
        name: 'Cloud Exit',
        stage: 'closed_won',
        pipelineStageName: 'Won and lost',
        pipelineStage: { isWon: true, isLost: true, deletedAt: null },
        valueMicros: 9_000_000n,
        probability: 80,
        dueDate: new Date('2026-09-01T00:00:00.000Z'),
        industry: null,
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      tasks: [],
      contacts: [],
      notes: [],
    });

    expect(brief).toContain('recorded Cloud Exit as lost');
    expect(brief).toContain('the deal is recorded as lost, so do not draft it as an open pursuit');
    expect(brief).not.toContain('recorded as won');
    expect(brief).not.toContain('is pursuing');
    expect(brief).toContain('stored probability of 80%');
  });

  it('ignores win and loss flags on a deleted stage', () => {
    const brief = buildOpportunityBrief({
      opportunity: {
        code: 'OP-3005',
        customer: 'Fabrikam',
        name: 'Data Platform',
        stage: 's2_sent',
        pipelineStageName: 'Archived Lost',
        pipelineStage: {
          isWon: true,
          isLost: true,
          deletedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        valueMicros: 1_000_000n,
        probability: 50,
        dueDate: new Date('2026-09-01T00:00:00.000Z'),
        industry: null,
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      tasks: [
        {
          title: 'Send the pack',
          status: 'open',
          dueDate: new Date('2026-06-20T00:00:00.000Z'),
        },
      ],
      contacts: [
        {
          name: 'Jordan Owner',
          role: null,
          influence: null,
          sentiment: null,
          aiOptOut: false,
        },
      ],
      notes: [],
    });

    expect(brief).toContain('is pursuing');
    expect(brief).not.toContain('recorded as lost');
    expect(brief).not.toContain('recorded as won');
    expect(brief).not.toContain('Archived Lost');
    expect(brief).toContain('S2 Sent');
    expect(brief).toContain('No immediate CRM risk signal');
  });
});
