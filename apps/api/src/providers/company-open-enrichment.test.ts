import { describe, expect, it, vi } from 'vitest';

import { faviconProfile, fetchOpenCompanyProfile, latestWikidataEmployees, latestWikidataRevenue, resolveWikidataFacts, wikidataFactsOf, type OpenCompanyProfile } from './company-open-enrichment.js';

const now = new Date('2026-05-11T00:00:00.000Z');

describe('company open data verification', () => {
  it('maps a verified Wikidata company profile into CRM-ready data', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('wbsearchentities')) {
        return jsonResponse({
          search: [
            {
              id: 'Q2283',
              label: 'Microsoft',
              description: 'American multinational technology corporation',
              concepturi: 'https://www.wikidata.org/wiki/Q2283',
            },
          ],
        });
      }

      if (url.includes('wbgetentities')) {
        return jsonResponse({
          entities: {
            Q2283: {
              id: 'Q2283',
              labels: { en: { value: 'Microsoft' } },
              descriptions: {
                en: { value: 'American multinational technology corporation' },
              },
              claims: {
                P856: [claim('https://www.microsoft.com/')],
                P154: [claim('Microsoft_logo.svg')],
                P18: [claim('Microsoft_building.jpg')],
                P571: [claim({ time: '+1975-04-04T00:00:00Z' })],
                P1128: [claim({ amount: '+221000' })],
                P452: [claim({ id: 'Q4830453' })],
              },
              sitelinks: { enwiki: { title: 'Microsoft' } },
            },
          },
        });
      }

      if (url.includes('/page/summary/Microsoft')) {
        return jsonResponse({
          extract: 'Microsoft is an American multinational technology corporation.',
          thumbnail: { source: 'https://upload.wikimedia.org/microsoft-thumb.jpg' },
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Microsoft' } },
        });
      }

      throw new Error(`Unexpected request ${url}`);
    });

    const profile = await fetchOpenCompanyProfile({
      name: 'Microsoft',
      domain: 'microsoft.com',
      now,
      fetchImpl,
    });

    expect(profile).toMatchObject({
      legalName: 'Microsoft',
      tradeName: 'Microsoft',
      domain: 'microsoft.com',
      website: 'https://www.microsoft.com/',
      logoSource: 'wikimedia',
      imageUrl: expect.stringContaining('Microsoft_building.jpg'),
      employeeCount: 221000,
      incorporationDate: '1975-04-04',
    });
    expect(profile?.logoUrl).toContain('Special:Redirect/file/Microsoft_logo.svg');
    expect(profile?.sourceAttribution.map((item) => item.source)).toEqual([
      'wikidata',
      'wikipedia',
    ]);
    expect(profile?.confidenceBps).toBeGreaterThanOrEqual(9000);
  });

  it('rejects ambiguous non-company name matches instead of fabricating a profile', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('wbsearchentities')) {
        return jsonResponse({
          search: [
            {
              id: 'Q6247',
              label: 'Mantua',
              description: 'city in Lombardy, Italy',
              concepturi: 'https://www.wikidata.org/wiki/Q6247',
            },
          ],
        });
      }

      if (url.includes('wbgetentities')) {
        return jsonResponse({
          entities: {
            Q6247: {
              id: 'Q6247',
              labels: { en: { value: 'Mantua' } },
              descriptions: { en: { value: 'city in Lombardy, Italy' } },
              claims: {
                P856: [claim('https://www.comune.mantova.it/')],
              },
              sitelinks: { enwiki: { title: 'Mantua' } },
            },
          },
        });
      }

      throw new Error(`Unexpected request ${url}`);
    });

    const profile = await fetchOpenCompanyProfile({
      name: 'Mantu',
      domain: 'mantu.com',
      now,
      fetchImpl,
    });

    expect(profile).toBeNull();
  });

  it('drops Wikidata inception dates with unknown month or day precision', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('wbsearchentities')) {
        return jsonResponse({
          search: [
            {
              id: 'Q5011970',
              label: 'CI Financial',
              description: 'Canadian investment management company',
              concepturi: 'https://www.wikidata.org/wiki/Q5011970',
            },
          ],
        });
      }

      if (url.includes('wbgetentities')) {
        return jsonResponse({
          entities: {
            Q5011970: {
              id: 'Q5011970',
              labels: { en: { value: 'CI Financial' } },
              descriptions: {
                en: { value: 'Canadian investment management company' },
              },
              claims: {
                P856: [claim('https://www.ci.com/')],
                P571: [claim({ time: '+1965-00-00T00:00:00Z' })],
              },
              sitelinks: { enwiki: { title: 'CI Financial' } },
            },
          },
        });
      }

      if (url.includes('/page/summary/CI%20Financial')) {
        return jsonResponse({
          extract: 'CI Financial is a Canadian investment management company.',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/CI_Financial' } },
        });
      }

      throw new Error(`Unexpected request ${url}`);
    });

    const profile = await fetchOpenCompanyProfile({
      name: 'CI Financial',
      domain: 'ci.com',
      now,
      fetchImpl,
    });

    expect(profile?.incorporationDate).toBeNull();
  });

  it('exposes the latest Wikidata total revenue with its currency, year and entity link', async () => {
    // WHY: revenue showed "No data" for accounts without filings; Wikidata
    // P2123 is a public, linkable figure. The newest point in time must win,
    // and a deprecated statement must never be shown.
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('wbsearchentities')) {
        return jsonResponse({ search: [{ id: 'Q2283', label: 'Microsoft', description: 'American multinational technology corporation', concepturi: 'https://www.wikidata.org/wiki/Q2283' }] });
      }
      if (url.includes('wbgetentities')) {
        return jsonResponse({
          entities: {
            Q2283: {
              id: 'Q2283',
              labels: { en: { value: 'Microsoft' } },
              descriptions: { en: { value: 'American multinational technology corporation' } },
              claims: {
                P856: [claim('https://www.microsoft.com/')],
                P2123: [
                  revenue('+198270000000', 'Q4917', '+2022-00-00T00:00:00Z'),
                  revenue('+245122000000', 'Q4917', '+2024-06-30T00:00:00Z'),
                  revenue('+999000000000', 'Q4917', '+2025-00-00T00:00:00Z', 'deprecated'),
                  revenue('+211915000000', 'Q4917', '+2023-00-00T00:00:00Z'),
                ],
              },
              sitelinks: {},
            },
          },
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });

    const profile = await fetchOpenCompanyProfile({ name: 'Microsoft', domain: 'microsoft.com', now, fetchImpl });

    expect(profile?.revenue).toEqual({
      amount: 245_122_000_000,
      currency: 'USD',
      pointInTime: '2024-06-30',
      year: 2024,
      sourceUrl: 'https://www.wikidata.org/wiki/Q2283#P2123',
      sourceLabel: 'Wikidata',
    });
    expect(profile?.providerMetadata.revenue).toEqual(profile?.revenue);
  });

  it('leaves revenue empty when the Wikidata currency is unknown or no date is given', async () => {
    const entity = (claims: unknown[]) => ({ id: 'Q1', claims: { P2123: claims } });
    expect(latestWikidataRevenue(entity([revenue('+5000', 'Q999999999', '+2024-00-00T00:00:00Z')]))).toBeNull();
    expect(latestWikidataRevenue(entity([{ mainsnak: { datavalue: { value: { amount: '+5000', unit: 'http://www.wikidata.org/entity/Q4916' } } } }]))).toBeNull();
    expect(latestWikidataRevenue(entity([revenue('+7400000000', 'Q4916', '+2023-00-00T00:00:00Z')]))).toMatchObject({ amount: 7_400_000_000, currency: 'EUR', year: 2023, pointInTime: '2023' });
  });

  it('reads the latest dated Wikidata headcount with its entity link, and a year only when it is stated', () => {
    const entity = (claims: unknown[]) => ({ id: 'Q9', claims: { P1128: claims } });
    const emp = (amount: string, time: string | null, rank = 'normal') => ({
      rank,
      mainsnak: { datavalue: { value: { amount, unit: '1' } } },
      ...(time ? { qualifiers: { P585: [{ datavalue: { value: { time } } }] } } : {}),
    });
    expect(latestWikidataEmployees(entity([emp('+9000', '+2021-00-00T00:00:00Z'), emp('+12000', '+2024-03-00T00:00:00Z'), emp('+99999', '+2025-00-00T00:00:00Z', 'deprecated')]))).toEqual({
      count: 12_000,
      pointInTime: '2024-03',
      year: 2024,
      sourceUrl: 'https://www.wikidata.org/wiki/Q9#P1128',
      sourceLabel: 'Wikidata',
    });
    expect(latestWikidataEmployees(entity([emp('+640', null)]))).toMatchObject({ count: 640, year: null, pointInTime: null });
    expect(latestWikidataEmployees(entity([emp('+640', null), emp('+700', '+2020-00-00T00:00:00Z')]))).toMatchObject({ count: 700, year: 2020 });
    expect(latestWikidataEmployees(entity([emp('+0', '+2020-00-00T00:00:00Z')]))).toBeNull();
  });

  describe('Wikidata facts survive a Seamless profile', () => {
    const wikidata = (): OpenCompanyProfile =>
      ({
        revenue: { amount: 7_400_000_000, currency: 'EUR', pointInTime: '2024', year: 2024, sourceUrl: 'https://www.wikidata.org/wiki/Q1#P2123', sourceLabel: 'Wikidata' },
        employees: { count: 12_000, pointInTime: '2024', year: 2024, sourceUrl: 'https://www.wikidata.org/wiki/Q1#P1128', sourceLabel: 'Wikidata' },
        providerMetadata: { openDataProvider: 'wikidata_wikimedia', wikidataId: 'Q1' },
      }) as unknown as OpenCompanyProfile;
    const seamless = { providerMetadata: { openDataProvider: 'seamless' } } as unknown as OpenCompanyProfile;
    const input = { name: 'Acme' };

    it('takes the facts from the winning Wikidata profile without another lookup', async () => {
      const fetchOpen = vi.fn();
      const facts = await resolveWikidataFacts({ profile: wikidata(), seamlessWon: false, enabled: true, input, fetchOpen });
      expect(facts).toMatchObject({ wikidataId: 'Q1', revenue: { amount: 7_400_000_000 }, employees: { count: 12_000 } });
      expect(fetchOpen).not.toHaveBeenCalled();
    });

    it('still looks Wikidata up when Seamless won the profile, and keeps the revenue fact', async () => {
      const fetchOpen = vi.fn(async () => wikidata());
      const facts = await resolveWikidataFacts({ profile: seamless, seamlessWon: true, enabled: true, input, fetchOpen });
      expect(fetchOpen).toHaveBeenCalledWith(input);
      expect(facts?.revenue).toMatchObject({ amount: 7_400_000_000, currency: 'EUR', sourceUrl: 'https://www.wikidata.org/wiki/Q1#P2123' });
    });

    it('returns null, so the caller keeps what it stored, when the lookup fails or is switched off', async () => {
      expect(await resolveWikidataFacts({ profile: seamless, seamlessWon: true, enabled: true, input, fetchOpen: async () => Promise.reject(new Error('down')) })).toBeNull();
      const fetchOpen = vi.fn();
      expect(await resolveWikidataFacts({ profile: seamless, seamlessWon: true, enabled: false, input, fetchOpen })).toBeNull();
      expect(fetchOpen).not.toHaveBeenCalled();
      expect(wikidataFactsOf(seamless)).toBeNull();
    });
  });

  it('builds a direct favicon fallback when open profiles are unavailable', () => {
    const profile = faviconProfile({
      name: 'Mantu',
      domain: 'mantu.com',
      website: 'https://mantu.com/',
      now,
    });

    expect(profile).toMatchObject({
      domain: 'mantu.com',
      website: 'https://mantu.com/',
      logoUrl: 'https://mantu.com/favicon.ico',
      logoSource: 'favicon',
    });
    expect(profile.sourceAttribution[0]?.source).toBe('favicon');
  });
});

function claim(value: unknown) {
  return {
    mainsnak: {
      datavalue: { value },
    },
  };
}

function revenue(amount: string, currencyQid: string, time: string, rank = 'normal') {
  return {
    rank,
    mainsnak: { datavalue: { value: { amount, unit: `http://www.wikidata.org/entity/${currencyQid}` } } },
    qualifiers: { P585: [{ datavalue: { value: { time } } }] },
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}
