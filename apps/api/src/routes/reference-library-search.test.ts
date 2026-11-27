// The reference library search box only matched the title and the description.
// On the seeded library that misses the words the row is filed under:
// "healthcare" is Rush's industry and a tag, "governance" is only a DNB tag,
// and "System for Health" is the company name, not the case-study title.
// Contact name and email stay out of search.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  referenceLibrarySearchHits,
  referenceLibrarySearchWhere,
  type ReferenceSearchFields,
} from './reference-library-search.js';

const CI: ReferenceSearchFields = {
  title: 'CI Financial — Core banking platform modernization',
  description:
    'Migrated a legacy core-banking monolith to a cloud-native microservices estate on AWS — release lead time fell from weeks to days with 99.95% uptime in year one.',
  industry: 'financial_services',
  companyName: 'CI Financial',
  tags: ['cloud-migration', 'aws', 'financial-services', 'modernization'],
};

const RUSH: ReferenceSearchFields = {
  title: 'Rush University — EHR cloud migration',
  description:
    'Moved electronic health records to a HIPAA-compliant cloud platform for 14,000 staff, cutting clinician access times by 40% with a zero-downtime cutover.',
  industry: 'healthcare',
  companyName: 'Rush University System for Health',
  tags: ['healthcare', 'ehr', 'cloud-migration', 'compliance'],
};

const DNB: ReferenceSearchFields = {
  title: 'DNB Bank — Multi-region cloud landing zone',
  description:
    'Designed and rolled out a multi-region cloud landing zone with policy-as-code guardrails, enabling compliant workload onboarding across the Nordics.',
  industry: 'financial_services',
  companyName: 'DNB Bank',
  tags: ['cloud', 'landing-zone', 'governance', 'nordics'],
};

const SEEDED = [CI, RUSH, DNB];

function hits(search: string): string[] {
  return SEEDED.filter((row) => referenceLibrarySearchHits(row, search)).map((row) => row.title);
}

describe('reference library search', () => {
  it('finds the seeded case study by the industry, the tag, and the company name the title does not carry', () => {
    // WHY: typing the industry on the Rush row, the governance tag on DNB,
    // or the company name "Rush University System for Health" has to open
    // that case study. Those words are not in the title or the description.
    expect(hits('healthcare')).toEqual([RUSH.title]);
    expect(hits('governance')).toEqual([DNB.title]);
    expect(hits('System for Health')).toEqual([RUSH.title]);
    expect(hits('landing-zone')).toEqual([DNB.title]);
    expect(hits('financial_services')).toEqual([CI.title, DNB.title]);
  });

  it('still finds a case study by its title, and does not search the customer contact', () => {
    // WHY: widening the search must not drop the title match the box already
    // had. The contact email is not a search field.
    expect(hits('Core banking')).toEqual([CI.title]);
    expect(hits('mjohnson@ci.com')).toEqual([]);
    expect(hits('Michael Johnson')).toEqual([]);
    expect(referenceLibrarySearchHits({ ...RUSH, companyName: null }, 'System for Health')).toBe(
      false,
    );
    expect(referenceLibrarySearchHits({ ...DNB, tags: [] }, 'governance')).toBe(false);
  });

  it('matches a lowercase seeded tag when the query is capitalized, and ignores a blank query', () => {
    // WHY: the seeded tags are lowercase. "Governance" is the same tag.
    // A blank query is not a filter, or the library would go empty.
    expect(hits('Governance')).toEqual([DNB.title]);
    expect(referenceLibrarySearchHits(DNB, '   ')).toBe(false);
    expect(referenceLibrarySearchWhere('   ')).toBeUndefined();
    expect(referenceLibrarySearchWhere(undefined)).toBeUndefined();
  });

  it('asks the list query for industry, company name, and the whole tag', () => {
    // WHY: the hit rule has to be the filter GET /references applies. A tag
    // matches as a whole tag, and the capitalized query is also tried in
    // lowercase so "Governance" finds `governance`.
    expect(referenceLibrarySearchWhere('Governance')).toEqual({
      OR: [
        { title: { contains: 'Governance', mode: 'insensitive' } },
        { description: { contains: 'Governance', mode: 'insensitive' } },
        { industry: { contains: 'Governance', mode: 'insensitive' } },
        { company: { is: { name: { contains: 'Governance', mode: 'insensitive' } } } },
        { tags: { has: 'Governance' } },
        { tags: { has: 'governance' } },
      ],
    });
  });

  it('the list route uses that filter and does not keep the title-and-description search', () => {
    // WHY: /references?q=healthcare is this filter. Leaving the old title
    // and description clause in the route would still miss the seeded industry.
    const src = readFileSync(new URL('./references.ts', import.meta.url), 'utf8');
    expect(src).toContain('referenceLibrarySearchWhere(search)');
    expect(src).not.toContain("title: { contains: search, mode: 'insensitive' }");
    const searchSrc = readFileSync(
      new URL('./reference-library-search.ts', import.meta.url),
      'utf8',
    );
    expect(searchSrc).not.toContain('contactEmail');
    expect(searchSrc).not.toContain('contactName');
  });
});
