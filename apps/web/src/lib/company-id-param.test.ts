import { describe, expect, it } from 'vitest';

import { accountPipelineHref, companyIdParam } from './company-id-param';

const GLOBEX = '11111111-1111-4111-8111-111111111111';

describe('companyIdParam', () => {
  it('keeps a company uuid and drops a name, a script, or a blank', () => {
    // WHY: the deals list filters with companyId, and the API rejects anything
    // that is not a uuid. A customer name in that slot is a contains search
    // wearing an id, and a script must never reach the query string we send.
    expect(companyIdParam(`  ${GLOBEX}  `)).toBe(GLOBEX);
    expect(companyIdParam('Globex')).toBeUndefined();
    expect(companyIdParam('Globex Labs')).toBeUndefined();
    expect(companyIdParam('<script>alert(1)</script>')).toBeUndefined();
    expect(companyIdParam('../../admin')).toBeUndefined();
    expect(companyIdParam('')).toBeUndefined();
    expect(companyIdParam(null)).toBeUndefined();
    expect(companyIdParam(undefined)).toBeUndefined();
  });
});

describe('accountPipelineHref', () => {
  it('opens the deals list for the company id and never writes the account name', () => {
    // WHY: "Open pipeline" used /opportunities?search=<name>. Search matches
    // customer, deal title, and code, so Globex also returns Globex Labs.
    const href = accountPipelineHref(GLOBEX, 'Globex');
    expect(href).toBe(`/opportunities?companyId=${GLOBEX}`);
    expect(href).not.toContain('search=');
    expect(href).not.toContain('Globex');
  });

  it('keeps a name-keyed cockpit on the name search', () => {
    // WHY: a cockpit that has no company id cannot ask the deals API for one.
    // The name search stays the fallback for that legacy route only.
    expect(accountPipelineHref('globex', 'Globex')).toBe(
      '/opportunities?search=Globex',
    );
    expect(accountPipelineHref(null, 'Globex Labs')).toBe(
      '/opportunities?search=Globex%20Labs',
    );
  });
});
