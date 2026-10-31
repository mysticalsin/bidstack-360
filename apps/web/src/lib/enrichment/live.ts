// Maps the enrichment API (packages/shared account-enrichment, contract in
// /workspace/fleet/polo-enrichment-api.md) onto the account-page shape.
import type { Firmographics, HiringBreakdown, PotentialProject as ApiProject } from '@bidstack/shared';

import type { CompanyEnrichment, CountRow, OpenRole, PotentialProject, Sourced } from './types';

export interface ApiPosting {
  id: string;
  source: string;
  title: string;
  url: string | null;
  city: string | null;
  country: string | null;
  region: string;
  function: string;
  seniority: string;
  skills: string[];
  postedAt: string | null;
}
export interface ApiHiring {
  companyId: string;
  fetchedAt: string | null;
  hiring: HiringBreakdown;
  postings: ApiPosting[];
  postingsTotal: number;
}
export interface ApiProjects {
  companyId: string;
  fetchedAt: string | null;
  projects: ApiProject[];
}

export const PROVIDER_LABEL: Record<string, string> = { apollo: 'Apollo', seamless: 'Seamless.AI' };
export const FUNCTION_LABEL: Record<string, string> = {
  data: 'Data', ml_ai: 'ML & AI', engineering: 'Engineering', infrastructure: 'Infrastructure', security: 'Security',
  product: 'Product', design: 'Design', sales: 'Sales', marketing: 'Marketing', customer_success: 'Customer success',
  finance: 'Finance', people: 'People', operations: 'Operations', legal: 'Legal', other: 'Other',
};
export const SENIORITY_LABEL: Record<string, string> = {
  intern: 'Intern', junior: 'Junior', mid: 'Mid', senior: 'Senior', lead: 'Lead', principal: 'Principal',
  manager: 'Manager', director: 'Director', vp: 'VP', c_level: 'C-level',
};
export const SENIORITY_ORDER = Object.values(SENIORITY_LABEL);
export const REGION_LABEL: Record<string, string> = { EMEA: 'EMEA', AMER: 'North America', LATAM: 'Latin America', APAC: 'APAC', unknown: 'Unknown' };

const label = (m: Record<string, string>, k: string) => m[k] ?? k;

/** Statuses with no provider data behind them: the page falls back to Sample data. */
export function isSampleStatus(f: Pick<Firmographics, 'status' | 'providers'>): boolean {
  if (f.status === 'not_configured' || f.status === 'not_enriched') return true;
  const runs = Object.values(f.providers ?? {});
  return runs.length > 0 && runs.every((r) => r.status === 'not_configured');
}

const NOTICE: Record<string, string> = {
  not_configured: 'Company enrichment is not configured (no provider key), so this is sample data.',
  not_enriched: 'This account has not been enriched yet, so this is sample data.',
  pending: 'Enrichment is still running; some fields may fill in on the next run.',
  partial: 'Some fields were not returned by the providers.',
  budget_exceeded: 'This month’s enrichment credit budget is used up; showing the last values fetched.',
  rate_limited: 'The provider rate-limited the last run; it will retry.',
  error: 'The last enrichment run failed; showing the last values fetched.',
  no_domain: 'This account has no website domain, which enrichment needs.',
  not_found: 'The providers found no company for this account’s domain.',
};
export const noticeFor = (status: string): string | null => NOTICE[status] ?? null;

function rows(b: Array<{ key: string; count: number }>, m: Record<string, string>): CountRow[] {
  return b.filter((x) => x.count > 0).map((x) => ({ label: label(m, x.key), count: x.count }));
}

function role(p: ApiPosting): OpenRole {
  const place = [p.city, p.country].filter(Boolean).join(', ');
  return {
    id: p.id,
    title: p.title,
    function: label(FUNCTION_LABEL, p.function),
    seniority: label(SENIORITY_LABEL, p.seniority),
    region: label(REGION_LABEL, p.region),
    location: place || label(REGION_LABEL, p.region),
    postedAt: p.postedAt,
    source: label(PROVIDER_LABEL, p.source),
    url: p.url,
  };
}

const CONF_RANK = { high: 0, medium: 1, low: 2 } as const;

export function fromApi(f: Firmographics, h: ApiHiring | null, pr: ApiProjects | null): CompanyEnrichment {
  const fetchedAt = f.fetchedAt ?? new Date(0).toISOString();
  function src<T>(fields: string[], value: T): Sourced<T> {
    const p = fields.map((k) => f.provenance[k]).find(Boolean);
    return { value, source: label(PROVIDER_LABEL, p?.source ?? 'apollo'), asOf: p?.fetchedAt ?? fetchedAt };
  }
  const revenue = f.annualRevenueUsd != null || f.revenueRange
    ? src(['annualRevenueUsd', 'revenueRange'], { amount: f.annualRevenueUsd, range: f.revenueRange, currency: 'USD' })
    : null;
  const headcount = f.employeeCount != null || f.employeeRange
    ? src(['employeeCount', 'employeeRange'], {
        current: f.employeeCount,
        range: f.employeeRange,
        growth12m: f.headcountGrowth12m == null ? null : Math.round(f.headcountGrowth12m * 1000) / 10,
      })
    : null;
  // Apollo often gives only a country for subsidiaries: one entry per place, HQ first.
  const seen = new Set<string>();
  const locs = [...f.locations]
    .sort((a, b) => Number(b.kind === 'hq') - Number(a.kind === 'hq'))
    .map((l) => ({ city: l.city ?? l.state ?? l.country ?? '', country: l.country ?? '', hq: l.kind === 'hq' }))
    .filter((l) => {
      const k = `${l.city}|${l.country}`.toLowerCase();
      if (!l.city || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const roles = (h?.postings ?? []).map(role);
  const hiringSources = [...new Set((h?.postings ?? []).map((p) => label(PROVIDER_LABEL, p.source)))];
  const projects: PotentialProject[] = (pr?.projects ?? [])
    .map((p) => ({
      id: p.id,
      title: p.name,
      summary: p.rationale,
      confidence: p.confidence,
      inferredAt: pr?.fetchedAt ?? fetchedAt,
      source: p.method === 'rules+llm' ? 'hiring rules (wording by the org LLM)' : 'hiring rules',
      region: p.region,
      postingCount: p.postingCount,
      evidence: p.evidence.map((e) => ({
        id: e.postingId,
        title: e.title,
        function: '',
        seniority: label(SENIORITY_LABEL, e.seniority),
        region: label(REGION_LABEL, e.region),
        location: label(REGION_LABEL, e.region),
        postedAt: e.postedAt,
        source: label(PROVIDER_LABEL, e.source),
        url: e.url,
      })),
    }))
    .sort((a, b) => CONF_RANK[a.confidence] - CONF_RANK[b.confidence] || b.postingCount - a.postingCount);
  return {
    companyId: f.companyId,
    sample: false,
    status: f.status,
    notice: noticeFor(f.status),
    stale: f.stale,
    fetchedAt: f.fetchedAt,
    firmographics: {
      revenue,
      headcount,
      industry: f.industry ? src(['industry', 'industries'], f.industry.charAt(0).toUpperCase() + f.industry.slice(1)) : null,
      locations: locs.length ? src(['locations'], locs) : null,
    },
    hiring: {
      source: hiringSources.length ? `${hiringSources.join(' + ')} job postings` : 'Apollo job postings',
      asOf: h?.fetchedAt ?? fetchedAt,
      roles,
      total: h ? Math.max(h.postingsTotal, h.hiring.total) : 0,
      buckets: h
        ? {
            function: rows(h.hiring.byFunction, FUNCTION_LABEL),
            seniority: rows(h.hiring.bySeniority, SENIORITY_LABEL).sort((a, b) => SENIORITY_ORDER.indexOf(a.label) - SENIORITY_ORDER.indexOf(b.label)),
            region: rows(h.hiring.byRegion, REGION_LABEL),
          }
        : undefined,
    },
    projects,
  };
}
