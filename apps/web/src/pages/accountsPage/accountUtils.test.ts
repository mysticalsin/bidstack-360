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

describe('deriveAccount past close', () => {
  // WHY: the demo book leaves open bids on the calendar after their close day
  // (CI Financial 2026-07-22, Rush 2026-06-30). The All-accounts card still
  // folds that money into "open" pipeline and a Strong/Good health band.
  // A previous UTC day is past close. The close day itself, a missing date,
  // and a won or lost deal are not — those are not an open miss.
  const today = '2026-11-25';

  it('counts an open deal whose close date is a previous UTC day', () => {
    const row = deriveAccount(
      company(),
      [deal({ closeDate: '2026-07-22', stage: 'proposal' })],
      today,
    );
    expect(row.openDeals).toBe(1);
    expect(row.pastCloseDeals).toBe(1);
  });

  it('does not count a deal that closes today, a deal with no date, or a decided deal', () => {
    const row = deriveAccount(
      company(),
      [
        deal({ id: 'due-today', closeDate: today, stage: 'proposal' }),
        deal({ id: 'no-date', closeDate: null, stage: 'meeting' }),
        deal({ id: 'won', closeDate: '2026-04-28', stage: 'closed_won' }),
        deal({ id: 'lost', closeDate: '2026-04-12', stage: 'closed_lost' }),
      ],
      today,
    );
    expect(row.openDeals).toBe(2);
    expect(row.pastCloseDeals).toBe(0);
  });
});
