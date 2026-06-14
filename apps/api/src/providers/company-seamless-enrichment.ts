// Seamless.AI company enrichment — a paid EXTERNAL data source (same trust class
// as Apollo). Returns the shared OpenCompanyProfile shape so it drops into the
// enrichment service as a higher-priority source than the keyless Wikidata path.
//
// Auth: `Token: <SEAMLESS_API_KEY>` header (per Seamless OpenAPI). The key is read
// from env ONLY — never hard-coded or logged. No key → null (the service falls
// back to open enrichment). Fail-open on any error.
//
// Endpoint: POST {base}/search/companies → { data: [ {company...} ], success }.
// Rich fields (employees, revenue, technologies, funding, news) are preserved in
// providerMetadata.seamless for the account view; core fields map to the profile.

import type { SourceAttribution } from '@bidstack/shared';

import type { OpenCompanyProfile } from './company-open-enrichment.js';
import { attribution } from './company-open-enrichment.utils.js';

const DEFAULT_BASE_URL = 'https://api.seamless.ai/api/client/v1';
const TIMEOUT_MS = 15_000;

interface SeamlessCompany {
  name?: string;
  domain?: string;
  description?: string;
  country?: string;
  employeeCount?: number;
  staffCountRange?: string;
  revenueRange?: string;
  annualRevenue?: number;
  industries?: string[];
  technologies?: string[];
  foundedOn?: string | number;
  fundingTotal?: number;
  newsAndEvents?: unknown;
  sicCode?: string;
  companyType?: string;
  stockTicker?: string;
  linkedInId?: string;
  companyLIURL?: string;
  searchResultId?: string;
}

function toIso(v: string | number | undefined): string | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(typeof v === 'number' ? String(v) : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Enrich a company via Seamless.AI. Returns an OpenCompanyProfile (Seamless-
 * sourced) or null when no key is set, the call fails, or nothing matches.
 */
export async function fetchSeamlessCompany({
  name,
  domain,
  website,
  now = new Date(),
  apiKey = process.env.SEAMLESS_API_KEY,
  baseUrl = process.env.SEAMLESS_API_BASE_URL ?? DEFAULT_BASE_URL,
  fetchImpl = fetch,
}: {
  name: string;
  domain?: string | null;
  website?: string | null;
  now?: Date;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<OpenCompanyProfile | null> {
  if (!apiKey || !name.trim()) return null;

  let company: SeamlessCompany | undefined;
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/search/companies`, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Token: apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(
        domain ? { companyDomain: domain, limit: 1 } : { companyName: name, limit: 1 },
      ),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: SeamlessCompany[] };
    company = json.data?.[0];
  } catch {
    return null;
  }
  if (!company) return null;

  const resolvedDomain = company.domain ?? domain ?? null;
  const resolvedWebsite =
    website ?? (resolvedDomain ? `https://${resolvedDomain.replace(/^https?:\/\//, '')}/` : null);
  const src: SourceAttribution = attribution({
    source: 'seamless',
    label: 'Seamless.AI',
    // sourceUrl must be a valid URL; fall back to the vendor site.
    sourceUrl: resolvedWebsite ?? 'https://seamless.ai',
    fetchedAt: now,
    confidence: 0.9,
    providerMetadata: {},
  });

  return {
    legalName: company.name ?? name,
    tradeName: company.name ?? name,
    domain: resolvedDomain,
    website: resolvedWebsite,
    description: company.description ?? null,
    logoUrl: null,
    logoSource: null,
    imageUrl: null,
    employeeCount: typeof company.employeeCount === 'number' ? company.employeeCount : null,
    incorporationDate: toIso(company.foundedOn),
    industryLabels: Array.isArray(company.industries) ? company.industries.slice(0, 20) : [],
    // Paid, verified external source — higher confidence than the open path.
    confidenceBps: 9000,
    sourceAttribution: [src],
    providerMetadata: {
      seamless: {
        searchResultId: company.searchResultId ?? null,
        country: company.country ?? null,
        employeeCount: company.employeeCount ?? null,
        staffCountRange: company.staffCountRange ?? null,
        revenueRange: company.revenueRange ?? null,
        annualRevenue: company.annualRevenue ?? null,
        technologies: company.technologies ?? [],
        fundingTotal: company.fundingTotal ?? null,
        newsAndEvents: company.newsAndEvents ?? null,
        sicCode: company.sicCode ?? null,
        companyType: company.companyType ?? null,
        stockTicker: company.stockTicker ?? null,
        linkedInId: company.linkedInId ?? null,
        companyLIURL: company.companyLIURL ?? null,
      },
    },
  };
}
