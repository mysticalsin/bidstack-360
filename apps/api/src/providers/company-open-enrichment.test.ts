import { describe, expect, it, vi } from 'vitest';

import { faviconProfile, fetchOpenCompanyProfile } from './company-open-enrichment.js';

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
      legalName: null,
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
    expect(profile?.confidenceBps).toBe(0);
    expect(profile?.sourceAttribution.find((item) => item.source === 'wikidata')?.confidence).toBeNull();
    expect(profile?.sourceAttribution.find((item) => item.source === 'wikipedia')?.confidence).toBeNull();
    expect(profile?.legalName).toBeNull();
    expect(profile?.revenueAmount).toBeNull();
  });

  it('keeps the preferred official name and a recognized revenue currency', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.includes('wbsearchentities')) {
        return jsonResponse({
          search: [
            {
              id: 'Q80788',
              label: 'DNB Bank',
              description: 'Norwegian bank',
              concepturi: 'https://www.wikidata.org/wiki/Q80788',
            },
          ],
        });
      }
      if (url.includes('wbgetentities') && url.includes('props=labels')) {
        return jsonResponse({
          entities: {
            Q585: { labels: { en: { value: 'Oslo' } } },
            Q20: { labels: { en: { value: 'Norway' } } },
            Q132643: { labels: { en: { value: 'Norwegian krone' } } },
            Q4582045: { labels: { en: { value: 'Rune Bjerke' } } },
            Q837171: { labels: { en: { value: 'financial services' } } },
            Q909158: { labels: { en: { value: 'Oslo Stock Exchange' } } },
          },
        });
      }
      if (url.includes('wbgetentities')) {
        return jsonResponse({
          entities: {
            Q80788: {
              id: 'Q80788',
              labels: { en: { value: 'DNB Bank' } },
              descriptions: { en: { value: 'Norwegian bank' } },
              claims: {
                P856: [claim('https://www.dnb.no/')],
                P1128: [claim({ amount: '+9020', unit: '1' })],
                P2139: [claim({ amount: '+54857000000', unit: 'http://www.wikidata.org/entity/Q132643' })],
                P159: [claim({ id: 'Q585' })],
                P17: [claim({ id: 'Q20' })],
                P452: [claim({ id: 'Q837171' })],
                P169: [claim({ id: 'Q4582045' })],
                P414: [claim({ id: 'Q909158' })],
                P1448: [
                  claim({ text: 'Gjensidige NOR Sparebank ASA', language: 'nb' }, 'normal'),
                  claim({ text: 'DNB Bank ASA', language: 'nb' }, 'preferred'),
                ],
              },
              sitelinks: { enwiki: { title: 'DNB Bank' } },
            },
          },
        });
      }
      if (url.includes('/page/summary/')) {
        return jsonResponse({
          extract: 'DNB Bank is a Norwegian bank.',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/DNB_Bank' } },
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });

    const profile = await fetchOpenCompanyProfile({
      name: 'DNB Bank',
      domain: 'dnb.no',
      now,
      fetchImpl,
    });

    expect(profile?.legalName).toBe('DNB Bank ASA');
    expect(profile?.tradeName).toBe('DNB Bank');
    expect(profile?.employeeCount).toBe(9020);
    expect(profile?.revenueAmount).toBe(54_857_000_000);
    expect(profile?.revenueCurrency).toBe('NOK');
    expect(profile?.publicFacts).toMatchObject({
      headquarters: 'Oslo, Norway',
      chiefExecutive: 'Rune Bjerke',
      stockExchange: 'Oslo Stock Exchange',
      revenueCurrency: 'NOK',
      revenueLabel: '54,857,000,000 NOK',
    });
    expect(profile?.industryLabels).toEqual(['financial services']);
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
    expect(profile.sourceAttribution[0]?.confidence).toBeNull();
  });
});

function claim(value: unknown, rank = 'normal') {
  return {
    rank,
    mainsnak: {
      datavalue: { value },
    },
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}
