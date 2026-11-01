import { describe, expect, it } from 'vitest';

import { enrichmentSearchWhere, opportunityCustomerSearchWhere } from './dashboard.queries.js';

describe('company search query', () => {
  it('matches the typed name in the database instead of a fixed recent page', () => {
    // WHY: search loaded 200 deals and 500 enrichments, then filtered in
    // memory. A company outside that page was missing from the catalog.
    const where = enrichmentSearchWhere('org-1', 'Mantu');
    expect(where).toMatchObject({
      orgId: 'org-1',
      deletedAt: null,
      OR: expect.arrayContaining([
        { tradeName: { contains: 'Mantu', mode: 'insensitive' } },
        { domain: { contains: 'Mantu', mode: 'insensitive' } },
      ]),
    });
    expect(opportunityCustomerSearchWhere('org-1', 'Mantu')).toMatchObject({
      orgId: 'org-1',
      customer: { contains: 'Mantu', mode: 'insensitive' },
    });
  });
});
