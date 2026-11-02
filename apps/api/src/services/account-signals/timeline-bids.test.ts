import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { bidLinksToAccount, linkedTimelineBids } from './timeline-bids.js';

const ACME = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ACME_OPP = '44444444-4444-4444-8444-444444444444';

describe('account timeline bids', () => {
  it('does not show a bid because the buyer string matches', () => {
    // WHY: the timeline used buyer ILIKE %company name%. Acme's public bid
    // then appeared on every account whose name sat inside that label, and
    // a bid with no company id was treated as linked.
    const nameOnly = { id: 'name-only', buyer: 'Acme', companyId: null, opportunityId: null };
    const otherCompany = { id: 'other', buyer: 'Acme', companyId: OTHER, opportunityId: null };
    const unlistedDeal = { id: 'unlisted', buyer: 'Acme', companyId: null, opportunityId: 'opp-other' };
    const linkedCompany = { id: 'linked-co', buyer: 'Elsewhere', companyId: ACME, opportunityId: null };
    const linkedDeal = { id: 'linked-deal', buyer: 'Elsewhere', companyId: null, opportunityId: ACME_OPP };
    const deals = new Set([ACME_OPP]);

    expect(bidLinksToAccount(nameOnly, ACME, deals)).toBe(false);
    expect(bidLinksToAccount(otherCompany, ACME, deals)).toBe(false);
    expect(bidLinksToAccount(unlistedDeal, ACME, deals)).toBe(false);
    expect(bidLinksToAccount(linkedCompany, ACME, deals)).toBe(true);
    expect(bidLinksToAccount(linkedDeal, ACME, deals)).toBe(true);
    expect(bidLinksToAccount(linkedCompany, OTHER, deals)).toBe(false);
    expect(linkedTimelineBids(ACME, [nameOnly, otherCompany, unlistedDeal, linkedCompany, linkedDeal], deals).map((bid) => bid.id)).toEqual([
      'linked-co',
      'linked-deal',
    ]);
    expect(linkedTimelineBids(ACME, [nameOnly], new Set())).toEqual([]);
    expect(bidLinksToAccount({ id: 'blank', buyer: 'Acme', companyId: '  ', opportunityId: '' }, ACME, deals)).toBe(false);
  });

  it('does not query the timeline by buyer name', () => {
    const src = readFileSync(new URL('../../routes/account-signals.ts', import.meta.url), 'utf8');
    const start = src.indexOf("'/accounts/:companyId/timeline'");
    const end = src.indexOf("'/accounts/:companyId/initiatives'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('linkedTimelineBids');
    expect(body).not.toContain('buyer');
    expect(body).not.toContain('bidOpportunity');
  });
});
