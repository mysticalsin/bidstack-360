import { describe, expect, it, vi } from 'vitest';

import { fetchSeamlessCompany } from './company-seamless-enrichment.js';

const SAMPLE = {
  success: true,
  data: [
    {
      searchResultId: 'sr_1',
      name: 'Sanofi',
      domain: 'sanofi.com',
      country: 'France',
      description: 'R&D-driven biopharma.',
      employeeCount: 10001,
      staffCountRange: '10000+',
      revenueRange: '$10B+',
      annualRevenue: 43000000000,
      industries: ['Pharmaceuticals', 'Biotechnology'],
      technologies: ['SAP', 'Salesforce'],
      foundedOn: 1973,
      fundingTotal: 0,
      companyLIURL: 'https://linkedin.com/company/sanofi',
    },
  ],
};

function mockFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('fetchSeamlessCompany', () => {
  it('maps a Seamless company into an OpenCompanyProfile, source-tagged Seamless', async () => {
    const p = await fetchSeamlessCompany({
      name: 'Sanofi',
      apiKey: 'tok_x',
      fetchImpl: mockFetch(SAMPLE),
    });
    expect(p).not.toBeNull();
    expect(p!.legalName).toBe('Sanofi');
    expect(p!.domain).toBe('sanofi.com');
    expect(p!.website).toBe('https://sanofi.com/');
    expect(p!.description).toBe('R&D-driven biopharma.');
    expect(p!.employeeCount).toBe(10001);
    expect(p!.industryLabels).toEqual(['Pharmaceuticals', 'Biotechnology']);
    expect(p!.confidenceBps).toBe(9000);
    expect(p!.incorporationDate).toBe(new Date('1973').toISOString());
    expect(p!.sourceAttribution[0].source).toBe('seamless');
    expect(p!.sourceAttribution[0].label).toBe('Seamless.AI');
    // Rich fields preserved for the account view.
    const meta = p!.providerMetadata.seamless as Record<string, unknown>;
    expect(meta.annualRevenue).toBe(43000000000);
    expect(meta.technologies).toEqual(['SAP', 'Salesforce']);
  });

  it('returns null with no API key (without fetching)', async () => {
    const f = mockFetch(SAMPLE);
    expect(await fetchSeamlessCompany({ name: 'Sanofi', apiKey: undefined, fetchImpl: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('fails open to null on a non-ok response or empty data', async () => {
    expect(
      await fetchSeamlessCompany({ name: 'X', apiKey: 'k', fetchImpl: mockFetch(SAMPLE, false) }),
    ).toBeNull();
    expect(
      await fetchSeamlessCompany({ name: 'X', apiKey: 'k', fetchImpl: mockFetch({ data: [] }) }),
    ).toBeNull();
  });
});
