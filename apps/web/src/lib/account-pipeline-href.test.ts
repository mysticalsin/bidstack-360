// The account cockpit "Open pipeline" link used to search the whole book by
// the account's name. A name match is not that company: "Bank" hits every
// bank, and a renamed customer string misses the bids the card just showed.
// A company uuid has to open /opportunities?companyId= that record. A
// name-keyed cockpit has no uuid, so it keeps the name search.
import { describe, expect, it } from 'vitest';

import { accountPipelineHref, opportunityCompanyIdParam } from './account-pipeline-href';

const LOGISTEC = '11111111-1111-4111-8111-111111111111';

describe('account pipeline link', () => {
  it('opens the opportunities list on this company, not a name search', () => {
    expect(
      accountPipelineHref({ companyId: LOGISTEC, accountName: 'Logistec Corporation' }),
    ).toBe(`/opportunities?companyId=${LOGISTEC}`);
    expect(
      accountPipelineHref({ companyId: `  ${LOGISTEC}  `, accountName: 'Logistec Corporation' }),
    ).toBe(`/opportunities?companyId=${LOGISTEC}`);
  });

  it('keeps a name search when the cockpit key is not a company uuid', () => {
    expect(accountPipelineHref({ companyId: 'logistec', accountName: 'Logistec Corporation' })).toBe(
      '/opportunities?search=Logistec%20Corporation',
    );
    expect(accountPipelineHref({ accountName: 'DNB Bank' })).toBe(
      '/opportunities?search=DNB%20Bank',
    );
    expect(accountPipelineHref({ companyId: '  ', accountName: '  ' })).toBe('/opportunities');
    expect(accountPipelineHref({})).toBe('/opportunities');
  });

  it('reads a company id from the list url and drops anything that is not a uuid', () => {
    expect(opportunityCompanyIdParam(LOGISTEC)).toBe(LOGISTEC);
    expect(opportunityCompanyIdParam(` ${LOGISTEC} `)).toBe(LOGISTEC);
    expect(opportunityCompanyIdParam('logistec')).toBeUndefined();
    expect(opportunityCompanyIdParam(null)).toBeUndefined();
  });
});
