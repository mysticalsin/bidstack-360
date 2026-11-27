import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildOpportunityBrief } from './opportunities.brief.js';
import { opportunityBriefIndustry } from './opportunity-brief-industry.js';

const here = dirname(fileURLToPath(import.meta.url));

// The opportunity industry picker. The record title-cases each of these.
// Demo OP-2041 stores the first one.
const DEMO_INDUSTRY_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['financial_services', 'Financial Services'],
  ['insurance', 'Insurance'],
  ['healthcare', 'Healthcare'],
  ['manufacturing', 'Manufacturing'],
  ['retail', 'Retail'],
  ['technology', 'Technology'],
  ['energy', 'Energy'],
  ['government', 'Government'],
  ['education', 'Education'],
  ['telecom', 'Telecom'],
  ['transportation', 'Transportation'],
  ['logistics', 'Logistics'],
  ['media', 'Media'],
  ['real_estate', 'Real Estate'],
  ['professional_services', 'Professional Services'],
  ['other', 'Other'],
];

function briefFor(industry: string | null) {
  return buildOpportunityBrief({
    opportunity: {
      code: 'OP-2041',
      customer: 'CI Financial',
      name: 'IT Modernization and MSP',
      stage: 's3_technical_iteration',
      pipelineStageName: null,
      valueMicros: 1_240_000_000_000n,
      probability: 65,
      dueDate: new Date('2026-07-22T00:00:00.000Z'),
      industry,
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    tasks: [],
    contacts: [],
    notes: [],
  });
}

describe('opportunity brief industry under demo data', () => {
  it('names Financial Services when a seeded bid stores financial_services', () => {
    // WHY: demo OP-2041 is CI Financial, industry financial_services. The
    // record already says Financial Services. The exec brief printed the key.
    const industry = opportunityBriefIndustry('financial_services');
    const brief = briefFor('financial_services');

    expect(industry).toBe('Financial Services');
    expect(brief).toContain('**Industry:** Financial Services');
    expect(brief).not.toContain('financial_services');
  });

  it('names every industry key the record already title-cases', () => {
    for (const [key, name] of DEMO_INDUSTRY_NAMES) {
      expect(opportunityBriefIndustry(key)).toBe(name);
      expect(opportunityBriefIndustry(`  ${key}  `)).toBe(name);
      expect(briefFor(key)).toContain(`**Industry:** ${name}`);
    }
  });

  it('keeps a stored industry name and an unknown key as written', () => {
    expect(opportunityBriefIndustry('Financial Services')).toBe('Financial Services');
    expect(opportunityBriefIndustry('zz_custom')).toBe('zz_custom');
    expect(opportunityBriefIndustry('consulting')).toBe('consulting');
    expect(briefFor('zz_custom')).toContain('**Industry:** zz_custom');
  });

  it('says not set when the industry is missing', () => {
    expect(opportunityBriefIndustry(null)).toBe('not set');
    expect(opportunityBriefIndustry('   ')).toBe('not set');
    expect(briefFor(null)).toContain('**Industry:** not set');
    expect(briefFor('   ')).toContain('**Industry:** not set');
  });

  it('asks the brief builder for that name', () => {
    const source = readFileSync(resolve(here, 'opportunities.brief.ts'), 'utf8');
    const industryLine = source
      .split('\n')
      .find((line) => line.includes('**Industry:**'));
    expect(industryLine).toContain('opportunityBriefIndustry(');
    expect(industryLine).not.toContain('${opportunity.industry}');
  });
});
