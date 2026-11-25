import { describe, expect, it } from 'vitest';

import type { CrmCompany, CrmDeal } from '@bidstack/shared';

import { deriveAccount, segmentMatches, techStackPillsFor, topTechFor } from './accountUtils';

const now = '2026-06-16T12:00:00.000Z';

function company(overrides: Partial<CrmCompany> = {}): CrmCompany {
  return {
    id: 'co-acme',
    source: 'external_crm',
    name: 'Acme',
    legalName: null,
    domain: null,
    website: null,
    industry: null,
    imageUrl: null,
    employeeCount: null,
    annualRevenueMicros: null,
    status: null,
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    technicalStack: [],
    confidence: 0.72,
    sourceAttribution: [],
    updatedAt: now,
    ...overrides,
  };
}

function deal(overrides: Partial<CrmDeal> = {}): CrmDeal {
  return {
    id: 'deal-1',
    source: 'external_crm',
    companyId: 'co-acme',
    companyName: 'Acme',
    name: 'Expansion',
    stage: 'proposal',
    amountMicros: 1_000_000_000_000,
    currencyCode: 'EUR',
    probability: 50,
    closeDate: null,
    ownerId: null,
    ownerName: null,
    updatedAt: now,
    ...overrides,
  };
}

describe('accountUtils', () => {
  it('derives coverage from account fields that make the list actionable', () => {
    const row = deriveAccount(
      company({
        industry: 'Manufacturing',
        domain: 'acme.example',
        employeeCount: 1200,
        logo: {
          url: 'https://cdn.example/acme.png',
          source: 'official_website',
          cachedAt: now,
          attribution: null,
        },
        technicalStack: [{ label: 'Cloud', items: [{ name: 'Azure', source: 'manual', confidence: 0.9 }] }],
      }),
      [deal()],
    );

    expect(row.coverage).toEqual({
      score: 100,
      present: ['Industry', 'Domain', 'Logo', 'Tech stack', 'FTE', 'Pipeline'],
      missing: [],
      reason: 'All account list signals are present.',
      nextAction: 'Open the cockpit to review strategy and activity.',
    });
    expect(segmentMatches(row, 'with_tech')).toBe(true);
    expect(techStackPillsFor(row.company)).toEqual(['Cloud: Azure']);
  });

  it('flags sparse accounts for data work and watch-list review', () => {
    const row = deriveAccount(company(), []);

    expect(row.health).toBe('critical');
    expect(row.coverage.score).toBe(0);
    expect(row.coverage.present).toEqual([]);
    expect(row.coverage.missing).toEqual([
      'Industry',
      'Domain',
      'Logo',
      'Tech stack',
      'FTE',
      'Pipeline',
    ]);
    expect(row.coverage.reason).toBe('Missing Industry, Domain, and Logo.');
    expect(row.coverage.nextAction).toBe('Assign an industry to unlock sector routing.');
    expect(segmentMatches(row, 'needs_data')).toBe(true);
    expect(segmentMatches(row, 'watch')).toBe(true);
  });

  // The demo book closes April–September 2026. On a later day those open deals
  // are past due, but health is only a pipeline-size band, so a large overdue
  // book still reads Strong. The list has to count the clock separately or a
  // sales lead treats a missed deadline as a healthy pipeline.
  it('counts an open deal past its close date and leaves a current or closed one', () => {
    const now = new Date('2026-11-25T12:00:00.000Z');
    const row = deriveAccount(
      company(),
      [
        deal({ id: 'past', closeDate: '2026-07-22' }),
        deal({ id: 'future', closeDate: '2026-12-01' }),
        deal({ id: 'today', closeDate: '2026-11-25' }),
        deal({ id: 'won', stage: 'closed_won', closeDate: '2026-04-12' }),
        deal({ id: 'blank', closeDate: null }),
        deal({ id: 'other', companyId: 'other', companyName: 'Other', closeDate: '2026-04-12' }),
      ],
      now,
    );

    expect(row.openDeals).toBe(4);
    expect(row.overdueDeals).toBe(1);
    expect(row.health).toBe('strong');
  });
});

describe('topTechFor', () => {
  it('returns the three most confident technologies across categories, one per name', () => {
    const top = topTechFor(
      company({
        technicalStack: [
          { label: 'Cloud', items: [{ name: 'AWS', source: 'open_data:dns', confidence: 0.7 }, { name: 'Azure', source: 'open_data:dns', confidence: 0.95 }] },
          { label: 'CRM', items: [{ name: 'Salesforce', source: 'apollo_io', confidence: 0.82 }] },
          { label: 'Data', items: [{ name: 'Snowflake', source: 'open_data:jobs', confidence: 0.6 }, { name: 'AWS', source: 'open_data:jobs', confidence: 0.99 }] },
        ],
      }),
    );
    expect(top).toEqual([
      { name: 'AWS', category: 'Data' },
      { name: 'Azure', category: 'Cloud' },
      { name: 'Salesforce', category: 'CRM' },
    ]);
  });

  it('is empty when the account has no stack', () => {
    expect(topTechFor(company())).toEqual([]);
  });
});
