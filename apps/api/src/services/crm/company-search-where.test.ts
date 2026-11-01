import { describe, expect, it } from 'vitest';

import {
  companiesMatchingRecordedCountry,
  enrichmentSearchWhere,
  opportunityCustomerSearchWhere,
} from './dashboard.queries.js';

const MATCH_NOTHING = {
  AND: [{ orgId: 'org-1' }, { NOT: { orgId: 'org-1' } }],
};

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

  it('keeps a company only when a recorded country matches the ISO-2 code', () => {
    // WHY: the search accepts country and used to drop it, so FR returned
    // every country. fr and FR are the same code. A non-ISO value is not
    // "all countries". An omitted country must not add a country predicate.
    expect(opportunityCustomerSearchWhere('org-1', 'Acme', undefined, 'fr')).toMatchObject({
      orgId: 'org-1',
      customer: { contains: 'Acme', mode: 'insensitive' },
      AND: [
        {
          OR: [
            { country: { equals: 'FR', mode: 'insensitive' } },
            {
              company: {
                is: {
                  deletedAt: null,
                  countryCode: { equals: 'FR', mode: 'insensitive' },
                },
              },
            },
          ],
        },
      ],
    });

    const scoped = opportunityCustomerSearchWhere(
      'org-1',
      'Acme',
      { unrestricted: false, countries: ['DE'], userId: 'user-1' },
      ' fr ',
    );
    expect(JSON.stringify(scoped)).toContain('"equals":"FR"');
    expect(JSON.stringify(scoped)).toContain('user-1');

    expect(opportunityCustomerSearchWhere('org-1', 'Acme', undefined, 'France')).toEqual(MATCH_NOTHING);
    expect(JSON.stringify(opportunityCustomerSearchWhere('org-1', 'Acme', undefined, 'FRA'))).not.toContain(
      'Acme',
    );
    expect(enrichmentSearchWhere('org-1', 'Acme', 'France', ['acme'])).toEqual(MATCH_NOTHING);
    expect(enrichmentSearchWhere('org-1', 'Acme', 'fr')).toEqual(MATCH_NOTHING);
    expect(enrichmentSearchWhere('org-1', 'Acme', 'FR', [])).toEqual(MATCH_NOTHING);
    expect(enrichmentSearchWhere('org-1', 'Acme', 'fr', ['acme'])).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          orgId: 'org-1',
          deletedAt: null,
          OR: expect.arrayContaining([{ tradeName: { contains: 'Acme', mode: 'insensitive' } }]),
        }),
        { normalizedName: { in: ['acme'] } },
      ]),
    });

    const unfilteredOpp = opportunityCustomerSearchWhere('org-1', 'Acme');
    expect(unfilteredOpp).not.toHaveProperty('AND');
    expect(JSON.stringify(unfilteredOpp)).not.toContain('country');
    const unfilteredEnrichment = enrichmentSearchWhere('org-1', 'Acme');
    expect(JSON.stringify(unfilteredEnrichment)).not.toContain('country');
    expect(JSON.stringify(unfilteredEnrichment)).not.toContain('normalizedName');
    expect(opportunityCustomerSearchWhere('org-1', 'Acme', undefined, '  ')).toEqual(unfilteredOpp);
    expect(enrichmentSearchWhere('org-1', 'Acme', '')).toEqual(unfilteredEnrichment);
  });

  it('does not invent a company the country filter did not record', () => {
    // WHY: buildCompanies always injects Mantu. A country filter must not
    // invent that account when Mantu has no recorded country, and a non-ISO
    // value must not come back as every company.
    const mantu = { name: 'Mantu' };
    const acme = { name: 'Acme' };
    expect(companiesMatchingRecordedCountry('FR', [acme, mantu], ['Acme'])).toEqual([acme]);
    expect(companiesMatchingRecordedCountry('fr', [acme], ['ACME'])).toEqual([acme]);
    expect(companiesMatchingRecordedCountry('fr', [mantu], ['Mantu'])).toEqual([mantu]);
    expect(companiesMatchingRecordedCountry('France', [acme, mantu], ['Acme', 'Mantu'])).toEqual([]);
    expect(companiesMatchingRecordedCountry(undefined, [mantu], [])).toEqual([mantu]);
    expect(companiesMatchingRecordedCountry('', [mantu], [])).toEqual([mantu]);
  });
});
