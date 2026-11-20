import { describe, expect, it } from 'vitest';

import { inferCountry } from './country.js';

describe('inferCountry', () => {
  it('prefers the account country, then the address', () => {
    expect(inferCountry({ countryCode: 'de', domain: 'mahle.fr' })).toBe('DE');
    expect(inferCountry({ address: { country: 'NO' }, domain: 'dnb.com' })).toBe('NO');
  });

  it('reads a country-code domain and maps .uk to GB', () => {
    expect(inferCountry({ domain: 'https://www.dnb.no/en' })).toBe('NO');
    expect(inferCountry({ domain: 'example.co.uk' })).toBe('GB');
  });

  it('ignores generic and sold-as-generic endings', () => {
    expect(inferCountry({ domain: 'mahle.com' })).toBeNull();
    expect(inferCountry({ domain: 'startup.io' })).toBeNull();
    expect(inferCountry({ domain: 'brand.co' })).toBeNull();
    expect(inferCountry({ address: { country: 'Norway' } })).toBeNull();
  });
});
