import { describe, expect, it } from 'vitest';

import { headquartersFor, tickerForCompany } from './_tokens';

describe('name lookups', () => {
  it('does not turn a trade name into a city or a ticker', () => {
    // Why: DNB was shown as headquartered in Oslo because the name contained "dnb".
    expect(headquartersFor('DNB Bank')).toBeNull();
    expect(headquartersFor('Mantu')).toBeNull();
    expect(tickerForCompany('DNB Bank')).toBeNull();
    expect(tickerForCompany('Apple')).toBeNull();
  });
});
