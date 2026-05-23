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

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}
