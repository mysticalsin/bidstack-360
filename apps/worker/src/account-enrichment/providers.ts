/**
 * Account enrichment providers (2026-10-31): firmographics and open jobs per
 * CRM company, behind one interface. Apollo is the first source, Seamless the
 * second. Docs and limits: /workspace/fleet/polo-enrichment-providers.md.
 *
 * Keys come from the env names APOLLO_API_KEY and SEAMLESS_API_KEY only. They
 * are passed to the provider's own header and never logged or returned. With no
 * key a provider reports `not_configured` and spends nothing.
 *
 * Every paid call goes through `ctx.reserve(operation, credits)` first. The
 * caller writes the ledger row there and returns false when the monthly budget
 * would be exceeded, in which case the provider stops and returns what it has.
 */

export type EnrichmentProviderId = 'apollo' | 'seamless';

export interface EnrichmentLocation {
  city: string | null;
  state: string | null;
  country: string | null;
  kind: 'hq' | 'subsidiary';
}

/** Normalised fields. A missing key means the provider had nothing for it. */
export interface FirmographicFields {
  annualRevenueUsd?: number;
  revenueRange?: string;
  employeeCount?: number;
  employeeRange?: string;
  headcountGrowth6m?: number;
  headcountGrowth12m?: number;
  headcountGrowth24m?: number;
  industry?: string;
  industries?: string[];
  locations?: EnrichmentLocation[];
  techStack?: string[];
  departmentHeadcount?: Record<string, number>;
}

export const FIRMOGRAPHIC_FIELDS = [
  'annualRevenueUsd',
  'revenueRange',
  'employeeCount',
  'employeeRange',
  'headcountGrowth6m',
  'headcountGrowth12m',
  'headcountGrowth24m',
  'industry',
  'industries',
  'locations',
  'techStack',
  'departmentHeadcount',
] as const satisfies readonly (keyof FirmographicFields)[];

export interface ProviderJobPosting {
  externalId: string;
  title: string;
  url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postedAt: string | null;
  lastSeenAt: string | null;
}

export type ProviderStatus =
  | 'ok'
  | 'not_configured'
  | 'no_domain'
  | 'not_found'
  | 'pending'
  | 'budget_exceeded'
  | 'rate_limited'
  | 'error';

export interface ProviderResult {
  provider: EnrichmentProviderId;
  status: ProviderStatus;
  fields: FirmographicFields;
  /** null when this provider does not return postings or none were fetched. */
  jobPostings: ProviderJobPosting[] | null;
  providerCompanyId?: string;
  /** Seamless only: the research request to poll next time while pending. */
  pendingRequestId?: string;
  creditsUsed: number;
  retryAfterMs?: number;
  /** Short, secret-free reason (status code and provider error code). */
  error?: string;
  /** Company events the provider returned with the enrichment (no extra credits). */
  signals?: ProviderSignal[];
  /** Public LinkedIn company page URL, when the provider knows it. */
  linkedinUrl?: string;
}

/** A dated company event from a provider (Apollo funding_events today). */
export interface ProviderSignal {
  provider: EnrichmentProviderId;
  externalId: string;
  kind: 'FUNDING_ROUND';
  occurredAt: string;
  title: string;
  summary: string;
  url: string | null;
}

export interface EnrichmentInput {
  name: string;
  domain: string | null;
  /** Seamless research request left pending by an earlier run. */
  pendingRequestId?: string | null;
}

export interface ProviderContext {
  reserve: (operation: string, credits: number) => Promise<boolean>;
  /** Apollo job posting pages to read (1 credit each). 0 skips postings. */
  maxJobPages: number;
}

export interface EnrichmentProvider {
  id: EnrichmentProviderId;
  configured(): boolean;
  enrich(input: EnrichmentInput, ctx: ProviderContext): Promise<ProviderResult>;
  /** Optional: senior people at a company (org chart seed). */
  searchPeople?(input: PeopleSearchInput, ctx: Pick<ProviderContext, 'reserve'>): Promise<PeopleSearchResult>;
}

export interface PeopleSearchInput {
  domain: string | null;
  /** Provider's own organization id when an earlier enrichment found it. */
  providerCompanyId?: string | null;
}

/** A person from a people search. Apollo search returns no email, phone or photo. */
export interface ProviderPerson {
  externalId: string;
  name: string;
  title: string | null;
  refreshedAt: string | null;
}

export interface PeopleSearchResult {
  provider: EnrichmentProviderId;
  status: ProviderStatus;
  people: ProviderPerson[];
  creditsUsed: number;
  retryAfterMs?: number;
  error?: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ProviderOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Seamless: polls inside one run before leaving the request pending. */
  pollAttempts?: number;
  pollDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const SEAMLESS_BASE = 'https://api.seamless.ai/api/client/v1';
const JOBS_PER_PAGE = 100;

class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterMs?: number,
  ) {
    super(`${status}${code ? ` ${code}` : ''}`);
  }
}

export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function retryAfterMs(res: Response): number | undefined {
  const value = res.headers.get('retry-after');
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

async function getJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    let code = '';
    try {
      const body = (await res.json()) as Record<string, unknown>;
      const raw = body.error_code ?? body.code ?? body.error;
      if (typeof raw === 'string') code = raw.slice(0, 60);
    } catch {
      /* non-JSON error body: status is enough */
    }
    throw new ProviderHttpError(res.status, code, res.status === 429 ? retryAfterMs(res) : undefined);
  }
  return res.json();
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Numbers from Apollo or Seamless strings like "12,500" or "$1.2B". */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = str(value);
  if (!s) return null;
  const m = /^\$?\s*([\d.,]+)\s*([kmbt])?\b/i.exec(s.replace(/\s+usd$/i, ''));
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(m[2] ?? '').toLowerCase() as 'k'] ?? 1;
  return Math.round(n * mult);
}

function list(value: unknown): string[] {
  const out = Array.isArray(value)
    ? value.map((v) => str(typeof v === 'object' ? rec(v).name : v)).filter((v): v is string => Boolean(v))
    : (str(value) ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  return [...new Set(out)];
}

function failure(provider: EnrichmentProviderId, err: unknown, creditsUsed: number, base: Partial<ProviderResult> = {}): ProviderResult {
  if (err instanceof ProviderHttpError) {
    return {
      provider,
      fields: {},
      jobPostings: null,
      ...base,
      status: err.status === 429 ? 'rate_limited' : 'error',
      creditsUsed,
      retryAfterMs: err.retryAfterMs,
      error: err.message,
    };
  }
  const name = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'request_failed';
  return { provider, fields: {}, jobPostings: null, ...base, status: 'error', creditsUsed, error: name };
}

// ---------------------------------------------------------------- Apollo

export function mapApolloOrganization(org: Record<string, unknown>): FirmographicFields {
  const f: FirmographicFields = {};
  const revenue = parseAmount(org.annual_revenue ?? org.organization_revenue);
  if (revenue !== null) f.annualRevenueUsd = revenue;
  const printed = str(org.annual_revenue_printed ?? org.organization_revenue_printed);
  if (printed) f.revenueRange = printed;
  const employees = parseAmount(org.estimated_num_employees);
  if (employees !== null) f.employeeCount = employees;
  const growth: [keyof FirmographicFields, string][] = [
    ['headcountGrowth6m', 'organization_headcount_six_month_growth'],
    ['headcountGrowth12m', 'organization_headcount_twelve_month_growth'],
    ['headcountGrowth24m', 'organization_headcount_twenty_four_month_growth'],
  ];
  for (const [key, src] of growth) {
    const v = org[src];
    if (typeof v === 'number' && Number.isFinite(v)) (f as Record<string, unknown>)[key] = v;
  }
  const industry = str(org.industry);
  if (industry) f.industry = industry;
  const industries = list(org.industries);
  if (industries.length) f.industries = industries;
  const locations: EnrichmentLocation[] = [];
  if (str(org.city) || str(org.country)) {
    locations.push({ city: str(org.city), state: str(org.state), country: str(org.country), kind: 'hq' });
  }
  if (Array.isArray(org.suborganizations)) {
    for (const s of org.suborganizations.slice(0, 50)) {
      const country = str(rec(s).country);
      if (country) locations.push({ city: str(rec(s).city), state: str(rec(s).state), country, kind: 'subsidiary' });
    }
  }
  if (locations.length) f.locations = locations;
  const tech = list(org.technology_names);
  const current = list(org.current_technologies);
  const techStack = [...new Set([...tech, ...current])];
  if (techStack.length) f.techStack = techStack;
  const dept = rec(org.departmental_head_count);
  const depts = Object.fromEntries(
    Object.entries(dept).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0),
  );
  if (Object.keys(depts).length) f.departmentHeadcount = depts;
  return f;
}

/**
 * Apollo organization `funding_events` -> funding signals. Comes with the
 * organizations.enrich call (no extra credits). Unknown shapes are skipped.
 */
export function mapApolloFundingEvents(org: Record<string, unknown>, companyName: string): ProviderSignal[] {
  const rows = Array.isArray(org.funding_events) ? org.funding_events : [];
  const out: ProviderSignal[] = [];
  for (const raw of rows.slice(0, 20)) {
    const r = rec(raw);
    const date = str(r.date);
    const at = date ? new Date(date) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    const type = str(r.type) ?? 'Funding round';
    const amount = parseAmount(r.amount);
    const currency = str(r.currency) ?? '';
    const investors = str(r.investors);
    const money = amount !== null ? ` of ${currency === '$' || currency === 'USD' || !currency ? '$' : `${currency} `}${compact(amount)}` : '';
    const id = str(r.id) ?? `${type}:${at.toISOString().slice(0, 10)}`;
    const url = str(r.news_url);
    out.push({
      provider: 'apollo',
      externalId: `funding:${id}`,
      kind: 'FUNDING_ROUND',
      occurredAt: at.toISOString(),
      title: `${companyName}: ${type}${money}`,
      summary: investors ? `Investors: ${investors}` : `${type} reported by Apollo`,
      url: url && /^https?:\/\//.test(url) ? url : null,
    });
  }
  return out;
}

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}

function isApolloContactLead(row: Record<string, unknown>): boolean {
  return Object.keys(row).some((key) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      normalized === 'firstname' ||
      normalized === 'lastname' ||
      normalized === 'lastnameobfuscated' ||
      normalized.includes('email')
    );
  });
}

export function mapApolloJobPosting(row: unknown): ProviderJobPosting | null {
  const r = rec(row);
  // A person or contact lead is not an open job. Phone fields are not copied.
  if (isApolloContactLead(r)) return null;
  const id = str(r.id);
  const title = str(r.title);
  if (!id || !title) return null;
  const url = str(r.url);
  return {
    externalId: id,
    title,
    url: url && /^https?:\/\//i.test(url) ? url : null,
    city: str(r.city),
    state: str(r.state),
    country: str(r.country),
    postedAt: str(r.posted_at),
    lastSeenAt: str(r.last_seen_at),
  };
}

export function createApolloProvider(opts: ProviderOptions = {}): EnrichmentProvider {
  const env = opts.env ?? process.env;
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const key = (): string | null => env.APOLLO_API_KEY?.trim() || null;
  const headers = (apiKey: string): Record<string, string> => ({
    accept: 'application/json',
    'cache-control': 'no-cache',
    'x-api-key': apiKey,
  });
  return {
    id: 'apollo',
    configured: () => Boolean(key()),
    async enrich(input, ctx) {
      const apiKey = key();
      const base = { provider: 'apollo' as const, fields: {}, jobPostings: null, creditsUsed: 0 };
      if (!apiKey) return { ...base, status: 'not_configured' };
      const domain = normalizeDomain(input.domain);
      if (!domain) return { ...base, status: 'no_domain' };
      if (!(await ctx.reserve('organizations.enrich', 1))) return { ...base, status: 'budget_exceeded' };
      let credits = 1;
      let org: Record<string, unknown>;
      try {
        const body = rec(
          await getJson(fetchImpl, `${APOLLO_BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, { method: 'GET', headers: headers(apiKey) }, timeoutMs),
        );
        org = rec(body.organization);
      } catch (err) {
        return failure('apollo', err, credits);
      }
      const orgId = str(org.id);
      if (!orgId) return { ...base, creditsUsed: credits, status: 'not_found' };
      const fields = mapApolloOrganization(org);
      const signals = mapApolloFundingEvents(org, input.name);
      const li = str(org.linkedin_url);
      const linkedinUrl = li && /^https?:\/\/(www\.)?linkedin\.com\/company\//.test(li) ? li.replace(/^http:/, 'https:') : undefined;
      const result: ProviderResult = {
        ...base,
        status: 'ok',
        fields,
        providerCompanyId: orgId,
        creditsUsed: credits,
        ...(signals.length ? { signals } : {}),
        ...(linkedinUrl ? { linkedinUrl } : {}),
      };
      if (ctx.maxJobPages <= 0) return result;
      const postings: ProviderJobPosting[] = [];
      for (let page = 1; page <= ctx.maxJobPages; page++) {
        if (!(await ctx.reserve('organizations.job_postings', 1))) {
          return { ...result, status: 'budget_exceeded', jobPostings: page > 1 ? postings : null, creditsUsed: credits };
        }
        credits += 1;
        try {
          const body = rec(
            await getJson(
              fetchImpl,
              `${APOLLO_BASE}/organizations/${encodeURIComponent(orgId)}/job_postings?page=${page}&per_page=${JOBS_PER_PAGE}`,
              { method: 'GET', headers: headers(apiKey) },
              timeoutMs,
            ),
          );
          const rows = Array.isArray(body.organization_job_postings)
            ? body.organization_job_postings
            : Array.isArray(body.job_postings)
              ? body.job_postings
              : [];
          for (const row of rows) {
            const p = mapApolloJobPosting(row);
            if (p) postings.push(p);
          }
          if (rows.length < JOBS_PER_PAGE) break;
        } catch (err) {
          // Firmographics are already paid for: keep them, report the postings failure.
          const f = failure('apollo', err, credits, { fields, providerCompanyId: orgId });
          return { ...f, jobPostings: page > 1 ? postings : null };
        }
      }
      return { ...result, jobPostings: postings, creditsUsed: credits };
    },
  };
}

// ---------------------------------------------------------------- Seamless

export function mapSeamlessCompany(company: Record<string, unknown>): FirmographicFields {
  const f: FirmographicFields = {};
  const revenue = parseAmount(company.annualRevenue);
  if (revenue !== null) f.annualRevenueUsd = revenue;
  const range = str(company.companyRevenue);
  if (range) f.revenueRange = range;
  const staff = parseAmount(company.staffCount);
  if (staff !== null) f.employeeCount = staff;
  const size = str(company.companySize);
  if (size) f.employeeRange = size;
  const industries = list(company.industries);
  if (industries.length) {
    f.industry = industries[0]!;
    f.industries = industries;
  }
  const loc = rec(company.location);
  if (str(loc.city) || str(loc.country)) {
    f.locations = [{ city: str(loc.city), state: str(loc.state), country: str(loc.country), kind: 'hq' }];
  }
  const tech = list(company.topTechnologies);
  if (tech.length) f.techStack = tech;
  return f;
}

export function createSeamlessProvider(opts: ProviderOptions = {}): EnrichmentProvider {
  const env = opts.env ?? process.env;
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollAttempts = opts.pollAttempts ?? 5;
  const pollDelayMs = opts.pollDelayMs ?? 3_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const key = (): string | null => env.SEAMLESS_API_KEY?.trim() || null;
  const headers = (apiKey: string): Record<string, string> => ({
    accept: 'application/json',
    'content-type': 'application/json',
    Token: apiKey,
  });
  return {
    id: 'seamless',
    configured: () => Boolean(key()),
    async enrich(input, ctx) {
      const apiKey = key();
      const base = { provider: 'seamless' as const, fields: {}, jobPostings: null, creditsUsed: 0 };
      if (!apiKey) return { ...base, status: 'not_configured' };
      const domain = normalizeDomain(input.domain);
      let credits = 0;
      let requestId = input.pendingRequestId ?? null;
      if (!requestId) {
        if (!domain && !input.name.trim()) return { ...base, status: 'no_domain' };
        if (!(await ctx.reserve('companies.research', 1))) return { ...base, status: 'budget_exceeded' };
        credits = 1;
        try {
          const body = rec(
            await getJson(
              fetchImpl,
              `${SEAMLESS_BASE}/companies/research`,
              {
                method: 'POST',
                headers: headers(apiKey),
                body: JSON.stringify({ companies: [{ ...(domain ? { domain } : {}), companyName: input.name }] }),
              },
              timeoutMs,
            ),
          );
          const ids = Array.isArray(body.requestIds) ? body.requestIds : [];
          requestId = str(ids[0]);
        } catch (err) {
          return failure('seamless', err, credits);
        }
        if (!requestId) return { ...base, creditsUsed: credits, status: 'error', error: 'no_request_id' };
      }
      for (let attempt = 0; attempt < pollAttempts; attempt++) {
        if (attempt > 0) await sleep(pollDelayMs);
        let row: Record<string, unknown>;
        try {
          const raw = await getJson(
            fetchImpl,
            `${SEAMLESS_BASE}/companies/research/poll?requestIds=${encodeURIComponent(requestId)}`,
            { method: 'GET', headers: headers(apiKey) },
            timeoutMs,
          );
          const body = rec(raw);
          const data: unknown[] = Array.isArray(raw)
            ? raw
            : Array.isArray(body.data)
              ? body.data
              : Array.isArray(body.results)
                ? body.results
                : [];
          row = rec(data.find((d) => str(rec(d).requestId) === requestId) ?? data[0]);
        } catch (err) {
          return failure('seamless', err, credits, { pendingRequestId: requestId });
        }
        const status = str(row.status);
        if (status === 'done') {
          const company = rec(row.company);
          const fields = mapSeamlessCompany(company);
          return {
            ...base,
            status: Object.keys(fields).length ? 'ok' : 'not_found',
            fields,
            providerCompanyId: str(company.id) ?? undefined,
            creditsUsed: credits,
          };
        }
        if (status === 'error' || status === 'missing') {
          return { ...base, creditsUsed: credits, status: 'not_found', error: status };
        }
      }
      return { ...base, creditsUsed: credits, status: 'pending', pendingRequestId: requestId };
    },
  };
}

export function defaultProviders(opts: ProviderOptions = {}): EnrichmentProvider[] {
  return [createApolloProvider(opts), createSeamlessProvider(opts)];
}
