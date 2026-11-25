import { describe, expect, it } from 'vitest';

import { convertOpportunityName } from './convert-opportunity-name.js';

// The convert field shows this when the name is left empty. The mark is the
// same one already in that placeholder. A blank submit must store this name.
const SHOWN_WHEN_BLANK = 'Vestra Logistics \u2014 Opportunity';

describe('convertOpportunityName', () => {
  it('names a blank convert after the company, not the job title', () => {
    // WHY: demo leads stay titled (Hannah Berg at Vestra Logistics is Head of
    // Procurement). Leaving the name empty used to file the bid as the company
    // plus that job title. The field shows the company and the word Opportunity,
    // so that is the bid name.
    expect(
      convertOpportunityName({
        opportunityName: undefined,
        companyName: 'Vestra Logistics',
      }),
    ).toBe(SHOWN_WHEN_BLANK);
    expect(SHOWN_WHEN_BLANK).not.toContain('Head of Procurement');
  });

  it('keeps a name the user typed', () => {
    // WHY: a typed name is the bid. Blank is the only case that falls back.
    expect(
      convertOpportunityName({
        opportunityName: '  Polar Foods rollout  ',
        companyName: 'Polar Foods',
      }),
    ).toBe('Polar Foods rollout');
  });

  it('treats a whitespace name as blank', () => {
    // WHY: spaces are not a name. The form trims before it omits the field,
    // and a direct call with spaces must not store a blank bid name.
    expect(
      convertOpportunityName({
        opportunityName: '   ',
        companyName: 'Cape Health Networks',
      }),
    ).toBe('Cape Health Networks \u2014 Opportunity');
  });

  it('uses Opportunity when the company is blank too', () => {
    // WHY: a missing company must not produce a name that is only a dash.
    expect(
      convertOpportunityName({
        opportunityName: null,
        companyName: '  ',
      }),
    ).toBe('Opportunity');
  });
});
