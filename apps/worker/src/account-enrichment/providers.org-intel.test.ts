// Slice 14: Apollo is used for ORGANIZATION fields only. These tests pin the
// org-level mapping (revenue, headcount growth, departments, funding, founded
// year, industry, technologies) and pin that the company intel path never
// calls a people or contact endpoint and never keeps an email or a phone.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createApolloProvider, mapApolloOrganization, type ProviderContext } from './providers.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Org payload as Apollo returns it, including org phone and contact-ish fields we must drop. */
export const APOLLO_ORG_WITH_CONTACT_FIELDS = {
  id: 'ap-org-1',
  name: 'Fjord Analytics',
  primary_domain: 'fjord.example',
  annual_revenue: 310_000_000,
  annual_revenue_printed: '310M',
  estimated_num_employees: 1450,
  organization_headcount_six_month_growth: 0.052,
  organization_headcount_twelve_month_growth: 0.11,
  departmental_head_count: { engineering: 420, sales: 180, finance: 0, data_science: 75 },
  total_funding: 182_000_000,
  total_funding_printed: '182M',
  latest_funding_stage: 'Series C',
  latest_funding_round_date: '2025-09-15T00:00:00.000+00:00',
  founded_year: 2011,
  industry: 'information technology & services',
  technology_names: ['Snowflake', 'dbt'],
  primary_phone: { number: '+47 22 00 00 00', source: 'Owler', sanitized_number: '+4722000000' },
  phone: '+47 22 00 00 00',
  sanitized_phone: '+4722000000',
  email: 'info@fjord.example',
  contact_emails: ['ceo@fjord.example'],
  people: [{ id: 'p1', name: 'Kari Nordmann', email: 'kari@fjord.example' }],
};

const PERSONAL = /phone|email|people|contact|person|\+47|@fjord/i;

function ctx(): ProviderContext & { reserved: Array<[string, number]> } {
  const reserved: Array<[string, number]> = [];
  return {
    reserved,
    maxJobPages: 0,
    reserve: async (op, credits) => {
      reserved.push([op, credits]);
      return true;
    },
  };
}

describe('Apollo organization mapping (slice 14)', () => {
  it('maps every org-level field the companies list shows', () => {
    const f = mapApolloOrganization(APOLLO_ORG_WITH_CONTACT_FIELDS);
    expect(f).toMatchObject({
      annualRevenueUsd: 310_000_000,
      revenueRange: '310M',
      employeeCount: 1450,
      headcountGrowth6m: 0.052,
      headcountGrowth12m: 0.11,
      departmentHeadcount: { engineering: 420, sales: 180, data_science: 75 },
      totalFundingUsd: 182_000_000,
      latestFundingStage: 'Series C',
      latestFundingAt: '2025-09-15T00:00:00.000Z',
      foundedYear: 2011,
      industry: 'information technology & services',
      techStack: ['Snowflake', 'dbt'],
    });
  });

  it('drops phones, emails and people from the mapped fields', () => {
    const f = mapApolloOrganization(APOLLO_ORG_WITH_CONTACT_FIELDS);
    const json = JSON.stringify(f);
    expect(Object.keys(f).join(' ')).not.toMatch(PERSONAL);
    expect(json).not.toMatch(/\+47|@fjord|Kari/);
  });

  it('rejects a nonsensical founded year and funding date', () => {
    const f = mapApolloOrganization({ founded_year: 9999, latest_funding_round_date: 'soon' });
    expect(f.foundedYear).toBeUndefined();
    expect(f.latestFundingAt).toBeUndefined();
  });

  it('calls organizations/enrich only, one credit, when job pages are off', async () => {
    const calls: string[] = [];
    const provider = createApolloProvider({
      env: { APOLLO_API_KEY: 'test-key-not-real' },
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({ organization: APOLLO_ORG_WITH_CONTACT_FIELDS }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const c = ctx();
    const res = await provider.enrich({ name: 'Fjord Analytics', domain: 'https://www.fjord.example/' }, c);
    expect(res.status).toBe('ok');
    expect(calls).toEqual(['https://api.apollo.io/api/v1/organizations/enrich?domain=fjord.example']);
    expect(c.reserved).toEqual([['organizations.enrich', 1]]);
    expect(calls.join(' ')).not.toMatch(/people|contacts|person|email|phone|match/i);
  });

  it('spends nothing and calls nothing when APOLLO_API_KEY is unset', async () => {
    const calls: string[] = [];
    const provider = createApolloProvider({ env: {}, fetchImpl: async (url) => (calls.push(url), new Response('{}')) });
    const res = await provider.enrich({ name: 'Fjord', domain: 'fjord.example' }, ctx());
    expect(res.status).toBe('not_configured');
    expect(calls).toEqual([]);
  });

  it('keeps the company intel modules free of people search', () => {
    for (const rel of ['../lib/company-intel/full-refresh.ts', '../lib/company-intel/import-enrichment.ts']) {
      const src = readFileSync(join(HERE, rel), 'utf8');
      expect(src, rel).not.toMatch(/searchPeople|mixed_people|people\/match|contacts\/search/);
    }
  });
});
