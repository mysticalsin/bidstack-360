import { describe, expect, it } from 'vitest';

import { opportunityBriefAmount } from './opportunity-brief-amount.js';
import { buildOpportunityBrief } from './opportunities.brief.js';

const UNITS_61520_MICROS = 61_520_000_000n;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

describe('opportunity brief under demo data', () => {
  it('does not price a synthetic bid of 61520 as euros', () => {
    // WHY: the exec brief prints valueMicros with an EUR prefix. The column
    // does not store a currency. Demo synthetic data sent 61520 units through
    // that prefix, so the brief read as a euro baseline. The figure stays
    // 61520 and does not name EUR. Fractional cents stay exact.
    const brief = buildOpportunityBrief({
      opportunity: {
        code: 'OP-6152',
        customer: 'Example Industrial',
        name: 'Plant Controls',
        stage: 's3_technical_iteration',
        pipelineStageName: null,
        valueMicros: UNITS_61520_MICROS,
        probability: 40,
        dueDate: new Date('2026-09-01T00:00:00.000Z'),
        industry: 'Manufacturing',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      tasks: [],
      contacts: [],
      notes: [],
    });

    expect(brief).not.toMatch(/EUR|€/);
    expect(digits(brief)).toContain('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a value that is not an integer micros amount is not a price.
    // It must not fall through to an EUR zero.
    expect(opportunityBriefAmount(Number.NaN)).toBe('Not a number');
    expect(opportunityBriefAmount(1.5)).toBe('Not a number');
    expect(opportunityBriefAmount('nope')).toBe('Not a number');
    expect(opportunityBriefAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});
