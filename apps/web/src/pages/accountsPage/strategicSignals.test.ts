import { describe, expect, it } from 'vitest';

import {
  keyAccountSignal,
  sectorAccountSignal,
  sectorCoverageSignal,
  topAccountSignal,
} from './strategicSignals';

describe('strategicSignals', () => {
  it('marks key accounts complete only when strategy, buyer, and opportunity signals exist', () => {
    expect(
      keyAccountSignal({
        industry: 'Manufacturing',
        domain: 'acme.example',
        keyAccountNotes: 'Executive sponsor is engaged.',
        totalValue: 2_000_000,
        openDeals: 1,
        contactCount: 3,
        opportunityCount: 2,
      }),
    ).toEqual({
      status: 'complete',
      missing: [],
      reason: 'Strategic coverage is complete for this account.',
      nextAction: 'Use the cockpit for executive follow-through.',
    });

    expect(
      keyAccountSignal({
        industry: null,
        domain: null,
        keyAccountNotes: '',
        totalValue: 0,
        openDeals: 0,
        contactCount: 0,
        opportunityCount: 0,
      }),
    ).toMatchObject({
      status: 'needs_action',
      missing: ['industry', 'official domain', 'strategy note', 'buyer contacts', 'open opportunity'],
      reason: 'Missing industry, official domain, and strategy note.',
      nextAction: 'Assign an industry to unlock sector routing.',
    });
  });

  it('explains whether top accounts are curated or auto-ranked', () => {
    expect(
      topAccountSignal(
        {
          industry: 'Financial Services',
          domain: 'bank.example',
          topAccountRank: 4,
          totalValue: 7_000_000,
          wonValue: 1_000_000,
          openDeals: 2,
          contactCount: 5,
          opportunityCount: 3,
        },
        'curated',
      ),
    ).toMatchObject({
      status: 'complete',
      reason: 'Curated global rank #4 with buyer and revenue signals.',
      nextAction: 'Reconfirm the rank when pipeline or sponsorship changes.',
    });

    expect(
      topAccountSignal(
        {
          industry: null,
          domain: null,
          topAccountRank: null,
          totalValue: 0,
          wonValue: 0,
          openDeals: 0,
          contactCount: 0,
          opportunityCount: 0,
        },
        'auto',
      ),
    ).toMatchObject({
      status: 'needs_action',
      missing: ['industry', 'official domain', 'buyer contacts', 'revenue signal'],
      nextAction: 'Assign an industry so the top list can roll up by sector.',
    });
  });

  it('turns sector coverage gaps into deterministic next actions', () => {
    expect(
      sectorCoverageSignal({
        accountCount: 10,
        coverage: {
          knownFteAccounts: 7,
          verifiedAccounts: 10,
          logoAccounts: 4,
        },
      }),
    ).toEqual({
      status: 'needs_action',
      missing: ['FTE coverage', 'logo coverage'],
      reason: 'Gaps in FTE coverage and logo coverage.',
      nextAction: 'Add FTE values to size this sector accurately.',
    });
  });

  it('flags sector accounts that are not yet reliable planning inputs', () => {
    expect(
      sectorAccountSignal({
        domain: 'acme.example',
        employeeCount: 1200,
        source: 'verified_data',
        confidence: 0.91,
      }),
    ).toMatchObject({
      status: 'complete',
      reason: 'Verified account signal is strong.',
    });

    expect(
      sectorAccountSignal({
        domain: null,
        employeeCount: null,
        source: 'external_crm',
        confidence: 0.5,
      }),
    ).toMatchObject({
      status: 'needs_action',
      missing: ['official domain', 'FTE', 'verified source', 'confidence'],
      nextAction: 'Add the official domain for source verification.',
    });
  });
});
