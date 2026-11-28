// The account cockpit card is captioned "Open opportunities linked to {account}".
// It used to read the five newest bids in the whole book and then keep rows
// whose customer name matched. On the demo seed those five newest rows are
// closed deals (CI Financial, Rush, Mantu). Logistec, MAPFRE, MAHLE and DNB
// each have an open bid that never enters that window, so the card says the
// account has no opportunities while the header still shows their pipeline.
// A newer closed deal on the same account must not push the open bid off the
// list either: CI Financial's open modernization is older than its closed book.
import { describe, expect, it } from 'vitest';

import { accountBidsQuery, decidedBidsForAccount, openBidsForAccount } from './account-bids';

const LOGISTEC_ID = '11111111-1111-4111-8111-111111111111';

describe('account cockpit bid read', () => {
  it('asks for this company, not the five newest bids in the book', () => {
    expect(accountBidsQuery({ id: LOGISTEC_ID, name: 'Logistec Corporation' })).toEqual({
      companyId: LOGISTEC_ID,
      limit: 50,
    });
    // A name-keyed cockpit has no company uuid. The list filter requires a uuid,
    // so the read searches the account name instead of sending a bad id.
    expect(accountBidsQuery({ id: 'logistec', name: 'Logistec Corporation' })).toEqual({
      search: 'Logistec Corporation',
      limit: 50,
    });
    expect(accountBidsQuery(null)).toBeNull();
    expect(accountBidsQuery({ id: '  ', name: '  ' })).toBeNull();
  });

  it('keeps this account’s open bid when newer closed deals would fill a latest-five window', () => {
    const rows = [
      { id: 'h06', customer: 'CI Financial', name: 'Legacy app retirement', stage: 'closed_lost' },
      { id: 'h05', customer: 'CI Financial', name: 'Zero Trust expansion', stage: 'closed_won' },
      { id: 'rush', customer: 'Rush University System for Health', name: 'EHR integration', stage: 'closed_won' },
      { id: 'mantu', customer: 'Mantu', name: 'Workspace consolidation', stage: 'closed_lost' },
      { id: 'open', customer: 'CI Financial', name: 'IT Modernization & MSP', stage: 's3_technical_iteration' },
      { id: 'logistec', customer: 'Logistec Corporation', name: 'SOC 2 Readiness', stage: 's1_ongoing' },
    ];

    expect(openBidsForAccount(rows, 'CI Financial').map((row) => row.id)).toEqual(['open']);
    expect(openBidsForAccount(rows, 'Logistec Corporation').map((row) => row.id)).toEqual(['logistec']);
    // Win/loss reasons still see the closed book. Filtering the card to open
    // bids must not drop those decided deals.
    expect(decidedBidsForAccount(rows, 'CI Financial').map((row) => row.id)).toEqual(['h06', 'h05']);
    // A decided stage on the pipeline record closes the bid even if the legacy
    // stage string still says the deal is in flight.
    expect(
      openBidsForAccount(
        [{ id: 'won', customer: 'Aritzia', name: 'Endpoint Refresh', stage: 's4_negotiation', pipelineStage: { isWon: true, isLost: false } }],
        'Aritzia',
      ),
    ).toEqual([]);
  });
});
