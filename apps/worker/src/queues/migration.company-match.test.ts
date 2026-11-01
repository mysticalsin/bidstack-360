import { describe, expect, it } from 'vitest';

import { soleCompanyId } from './migration.js';

describe('soleCompanyId', () => {
  it('does not pick a company when two names match', () => {
    // WHY: import used the first case-insensitive name. "Acme" and "acme"
    // are two companies, so a contact must not be linked to one of them.
    expect(soleCompanyId([])).toEqual({ id: null, ambiguous: false });
    expect(soleCompanyId(['only'])).toEqual({ id: 'only', ambiguous: false });
    expect(soleCompanyId(['a', 'b'])).toEqual({ id: null, ambiguous: true });
  });
});
