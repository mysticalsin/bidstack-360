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
          influence: 88,
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
    expect(brief).toContain('Validate margin model');
    expect(brief).toContain('Avery Sponsor');
    expect(brief).not.toMatch(/stub|DUST_API_KEY|DUST_AGENT_EXEC_BRIEF/i);
    expect(brief).toContain('EUR 1250000');
    expect(estimateBriefTokens(brief)).toBeGreaterThan(50);
  });

  it('prints large values and fractional cents without Number(micros)/1e6', () => {
    // WHY: the brief used Intl on Number(micros)/1e6, which rounds cents
    // away and corrupts amounts past the safe-integer cliff.
    const large = 9_007_199_254_740_993n;
    const cents = 1_234_567n;
    const largeBrief = buildOpportunityBrief({
      opportunity: {
        code: 'OP-9001',
        customer: 'Exact Bank',
        name: 'Cliff deal',
        stage: 's2_sent',
        pipelineStageName: null,
        valueMicros: large,
        probability: 50,
        dueDate: null,
        industry: null,
        updatedAt: new Date('2026-11-02T00:00:00.000Z'),
      },
      tasks: [],
      contacts: [],
      notes: [],
    });
    const centsBrief = buildOpportunityBrief({
      opportunity: {
        code: 'OP-9002',
        customer: 'Exact Bank',
        name: 'Cents deal',
        stage: 's2_sent',
        pipelineStageName: null,
        valueMicros: cents,
        probability: 50,
        dueDate: null,
        industry: null,
        updatedAt: new Date('2026-11-02T00:00:00.000Z'),
      },
      tasks: [],
      contacts: [],
      notes: [],
    });

    expect((Number(large) / 1_000_000).toString()).not.toBe('9007199254.740993');
    expect(largeBrief).toContain('EUR 9007199254.740993');
    expect(centsBrief).toContain('EUR 1.234567');
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
        industry: null,
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
    expect(brief).toContain('low win probability requires bid/no-bid challenge');
  });
});
