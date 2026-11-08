import { describe, expect, it } from 'vitest';

import {
  contactsForCompanyWhere,
  contactsForOpportunityWhere,
  factsForContactsWhere,
  factsForListedPeople,
} from './people-map-scope.js';

describe('people map company scope', () => {
  it('loads one company and leaves the other company out', () => {
    // WHY: the company map is the contact query, not a distinct fact key.
    // Company B's id must not satisfy company A's where.
    const where = contactsForCompanyWhere('org-1', 'company-a');
    expect(where).toEqual({ orgId: 'org-1', companyId: 'company-a', deletedAt: null });
    expect(where.companyId).not.toBe('company-b');
  });

  it('loads an opportunity by the deal, not by a fact distinct', () => {
    expect(contactsForOpportunityWhere('org-1', 'deal-1')).toEqual({
      orgId: 'org-1',
      opportunityId: 'deal-1',
      deletedAt: null,
    });
    expect(factsForContactsWhere('org-1', ['person-a'])).toEqual({
      orgId: 'org-1',
      contactId: { in: ['person-a'] },
      deletedAt: null,
    });
  });

  it('keeps a listed person and drops a fact for someone who is not on the map', () => {
    // WHY: a fact.companyId points at a linked account. It does not put that
    // account's other people on this map. The person list is the scope.
    const facts = [
      { contactId: 'person-a', companyId: 'company-b', claim: 'linked' },
      { contactId: 'person-b', companyId: 'company-b', claim: 'other account' },
    ];
    expect(factsForListedPeople(['person-a'], facts)).toEqual([
      { contactId: 'person-a', companyId: 'company-b', claim: 'linked' },
    ]);
  });
});
