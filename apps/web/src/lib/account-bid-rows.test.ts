// The account pipeline chart is this company's bids. A company uuid is the
// account. A customer name is not a search, and a script is not an id.
import { describe, expect, it } from 'vitest';

import { accountBidQuery, rowsForAccountBids } from './account-bid-rows';

const GLOBEX = '11111111-1111-4111-8111-111111111111';

function bid(id: string, customer: string, stage: string) {
  return { id, customer, stage, value: 1_000, dueDate: '2026-09-01' };
}

describe('account bid query', () => {
  it('asks for this company and does not reuse the portfolio page', () => {
    // WHY: the chart used to read the latest 100 bids in the whole book, then
    // keep rows whose customer text matched the account name. An older bid
    // for this account never arrived, and Globex also matched Globex Labs
    // when the page fell back to search.
    const query = accountBidQuery(GLOBEX);

    expect(query.path).toBe(`/api/opportunities?limit=100&companyId=${GLOBEX}`);
    expect(query.path).not.toContain('search=');
    expect(query.path).not.toContain('Globex');
    expect(query.queryKey).toEqual(['opportunity-rows:viz', GLOBEX]);
  });

  it('trims a uuid and refuses a name, a script, a path, and a blank', () => {
    // WHY: companyId is a uuid on the deals API. Anything else 400s the read
    // or would put a name or a script into the address.
    expect(accountBidQuery(`  ${GLOBEX}  `).path).toBe(
      `/api/opportunities?limit=100&companyId=${GLOBEX}`,
    );
    expect(accountBidQuery(GLOBEX.toUpperCase()).path).toContain(`companyId=${GLOBEX.toUpperCase()}`);

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
      const query = accountBidQuery(bad);
      expect(query.path).toBe('/api/opportunities?limit=100');
      expect(query.path).not.toContain('companyId');
      expect(query.path).not.toContain('Globex');
      expect(query.path).not.toContain('script');
      expect(query.path).not.toContain('evil.example');
      expect(query.queryKey).toEqual(['opportunity-rows:viz']);
    }
  });
});

describe('rows for the account chart', () => {
  it('keeps a bid whose customer text differs once the company id scoped the read', () => {
    // WHY: the id is the account. The customer label may be the legal name.
    // Dropping it makes this account look empty.
    const rows = rowsForAccountBids(
      [bid('labs', 'Globex Labs', 's1_ongoing')],
      GLOBEX,
      'Globex',
    );

    expect(rows.map((row) => row.id)).toEqual(['labs']);
  });

  it('keeps an exact customer match when the cockpit has no company uuid', () => {
    // WHY: a name-keyed cockpit cannot ask the API for a company id. Exact
    // text stays. A sibling name is a different account.
    const rows = rowsForAccountBids(
      [
        bid('exact', 'Acme', 's2_sent'),
        bid('sibling', 'Acme Labs', 's1_ongoing'),
        bid('case', 'acme', 's4_negotiation'),
      ],
      'acme',
      'Acme',
    );

    expect(rows.map((row) => row.id)).toEqual(['exact', 'case']);
  });
});
