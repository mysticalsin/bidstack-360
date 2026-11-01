import { describe, expect, it } from 'vitest';

import { countriesMissingFromMap } from './WorldMap';

describe('countriesMissingFromMap', () => {
  it('keeps a recorded country visible when the sheet has no shape for its code', () => {
    const missing = countriesMissingFromMap([
      { countryCode: 'NO', countryCodeA3: 'NOR', opportunityCount: 1 },
      { countryCode: 'HK', countryCodeA3: 'HKG', opportunityCount: 2 },
      { countryCode: 'AQ', countryCodeA3: 'ATA', opportunityCount: 1 },
      { countryCode: 'XX', countryCodeA3: 'ZZZ', opportunityCount: 0 },
    ]);

    expect(missing.map((item) => item.countryCode)).toEqual(['HK']);
  });
});
