// The cockpit header and the recent-deals card are this company's bids.
// A company uuid is the account. A customer name is not a search, and a
// script is not an id.
import { describe, expect, it } from 'vitest';

import { accountDealFilter, cachedCockpitCompanyId, dealCompanyId, dealsForAccount } from './account-deal-read';

const GLOBEX = '11111111-1111-4111-8111-111111111111';

function bid(id: string, customer: string) {
  return { id, customer };
}

describe('account deal filter', () => {
  it('asks for this company and does not search by name', () => {
    // WHY: the header and the recent card used to read a short portfolio page
    // and keep rows whose customer text matched. An older bid never arrived,
    // and Globex also matched Globex Labs when the page fell back to search.
    expect(accountDealFilter(GLOBEX, 5)).toEqual({ companyId: GLOBEX, limit: 5 });
    expect(accountDealFilter(`  ${GLOBEX}  `, 50)).toEqual({ companyId: GLOBEX, limit: 50 });
    expect(JSON.stringify(accountDealFilter(GLOBEX, 5))).not.toContain('search');
    expect(JSON.stringify(accountDealFilter(GLOBEX, 5))).not.toContain('Globex');
  });

  it('refuses a name, a script, a path, and a blank', () => {
    // WHY: companyId is a uuid on the deals API. Anything else 400s the read
    // or would put a name or a script into the address.
    for (const bad of [
      'Globex',
      'Globex Labs',
      '<script>alert(1)</script>',
      'javascript:alert(1)',
      '../../admin',
      'https://evil.example/phish',
      `${GLOBEX}/extra`,
      '',
      '   ',
      null,
      undefined,
    ]) {
      const filter = accountDealFilter(bad, 50);
      expect(filter).toEqual({ limit: 50 });
      expect(dealCompanyId(bad)).toBeUndefined();
      expect(JSON.stringify(filter)).not.toContain('companyId');
      expect(JSON.stringify(filter)).not.toContain('Globex');
      expect(JSON.stringify(filter)).not.toContain('script');
      expect(JSON.stringify(filter)).not.toContain('evil.example');
    }
  });
});

describe('deals for the account', () => {
  it('keeps a bid whose customer text differs once the company id scoped the read', () => {
    // WHY: the id is the account. The customer label may be the legal name.
    // Dropping it makes this account look empty.
    const rows = dealsForAccount([bid('labs', 'Globex Labs')], GLOBEX, 'Globex');

    expect(rows.map((row) => row.id)).toEqual(['labs']);
  });

  it('keeps an exact customer match when the cockpit has no company uuid', () => {
    // WHY: a name-keyed cockpit cannot ask the API for a company id. Exact
    // text stays. A sibling name is a different account.
    const rows = dealsForAccount(
      [bid('exact', 'Acme'), bid('sibling', 'Acme Labs'), bid('case', 'acme')],
      'acme',
      'Acme',
    );

    expect(rows.map((row) => row.id)).toEqual(['exact', 'case']);
  });
});

describe('cached cockpit company id', () => {
  it('reads a stored company id and ignores a broken snapshot', () => {
    // WHY: a resumed cockpit paints the last snapshot before the live read
    // returns. The deal query has to follow that same company, and a corrupt
    // snapshot must not throw or become a companyId.
    sessionStorage.setItem(
      'bidstack:account-cockpit:globex',
      JSON.stringify({ cockpit: { company: { id: GLOBEX } } }),
    );
    expect(cachedCockpitCompanyId('globex')).toBe(GLOBEX);

    sessionStorage.setItem('bidstack:account-cockpit:broken', '{');
    expect(cachedCockpitCompanyId('broken')).toBeUndefined();
    expect(cachedCockpitCompanyId('missing')).toBeUndefined();
    sessionStorage.clear();
  });
});
