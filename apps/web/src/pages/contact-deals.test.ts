import { describe, expect, it } from 'vitest';

import { contactOpportunityCaption, dealsForContact } from './contact-deals';

describe('dealsForContact', () => {
  it('keeps a deal only when the company id matches', () => {
    // WHY: the contact page listed every bid with the same customer string.
    const deals = [
      { id: 'linked', companyId: 'co-1', customer: 'Other label' },
      { id: 'same-name', companyId: 'co-2', customer: 'Acme' },
      { id: 'unlinked', companyId: null, customer: 'Acme' },
    ];
    expect(dealsForContact(deals, 'co-1').map((deal) => deal.id)).toEqual(['linked']);
    expect(dealsForContact(deals, null)).toEqual([]);
  });

  it('says when the related bids are only the latest page', () => {
    expect(contactOpportunityCaption(2, true, true)).toBe('2 related in the latest 100 bids');
    expect(contactOpportunityCaption(0, false, false)).toBe('This contact is not linked to a company.');
  });
});
