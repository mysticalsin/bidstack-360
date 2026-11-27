import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildOpportunityBrief } from './opportunities.brief.js';
import { opportunityBriefStage } from './opportunity-brief-stage.js';

const here = dirname(fileURLToPath(import.meta.url));

const DEMO_STAGE_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['s1_lead', 'Lead'],
  ['s1_ongoing', 'Ongoing'],
  ['s2_sent', 'Proposal Sent'],
  ['s3_technical_iteration', 'Technical Iteration'],
  ['s4_negotiation', 'Negotiation'],
  ['closed_won', 'Closed Won'],
  ['closed_lost', 'Closed Lost'],
];

describe('opportunity brief stage under demo data', () => {
  it('names Technical Iteration when a seeded bid has no pipeline stage', () => {
    // WHY: demo OP-2041 stores stage as s3_technical_iteration and leaves
    // pipelineStageId empty. The exec brief printed that key. The catalog
    // name for that key is Technical Iteration.
    const stage = opportunityBriefStage({
      stage: 's3_technical_iteration',
      pipelineStageName: null,
    });
    const brief = buildOpportunityBrief({
      opportunity: {
        code: 'OP-2041',
        customer: 'CI Financial',
        name: 'IT Modernization and MSP',
        stage: 's3_technical_iteration',
        pipelineStageName: stage,
        valueMicros: 1_240_000_000_000n,
        probability: 65,
        dueDate: new Date('2026-07-22T00:00:00.000Z'),
        industry: 'financial_services',
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
      tasks: [],
      contacts: [],
      notes: [],
    });

    expect(stage).toBe('Technical Iteration');
    expect(brief).toContain('**Stage:** Technical Iteration');
    expect(brief).not.toContain('s3_technical_iteration');
  });

  it('names every demo stage key the catalog already uses', () => {
    for (const [key, name] of DEMO_STAGE_NAMES) {
      expect(opportunityBriefStage({ stage: key, pipelineStageName: null })).toBe(name);
      expect(opportunityBriefStage({ stage: key, pipelineStageName: '   ' })).toBe(name);
    }
  });

  it('keeps a stored pipeline stage name and an unknown key as written', () => {
    expect(
      opportunityBriefStage({
        stage: 's3_technical_iteration',
        pipelineStageName: 'Commit Review',
      }),
    ).toBe('Commit Review');
    expect(opportunityBriefStage({ stage: 'zz_custom', pipelineStageName: null })).toBe('zz_custom');
  });

  it('asks the brief route for that catalog name', () => {
    const source = readFileSync(resolve(here, 'opportunities.transitions.ts'), 'utf8');
    const briefCall = source.slice(source.indexOf('const brief = buildOpportunityBrief'));
    expect(briefCall).toContain('opportunityBriefStage(');
    expect(briefCall).not.toContain('pipelineStageName: opp.pipelineStage?.name ?? null');
  });
});
