// Apollo.io company enrichment worker.
//
// Job shape: { orgId, companyName, domain? }
// Prefer Apollo MCP company search/get-company when APOLLO_MCP_URL is configured
// so account research can stay in the credit-free search lane. Fall back to the
// REST organization enrichment endpoint only when APOLLO_API_KEY is configured.
// Maps the response
// to the CompanyEnrichment row keyed by (orgId, normalizedName), and writes an
// audit log entry. When APOLLO_API_KEY is unset the job is a no-op (same
// stub-mode pattern as dust-poll).

import { createHmac, timingSafeEqual } from 'node:crypto';

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { COMPANY_ENRICH_APOLLO } from '@bidstack/shared';

export const QUEUE_NAME = COMPANY_ENRICH_APOLLO.name;

const APOLLO_ENDPOINT = 'https://api.apollo.io/api/v1/organizations/enrich';
const APOLLO_PEOPLE_SEARCH_ENDPOINT = 'https://api.apollo.io/api/v1/mixed_people/api_search';
const APOLLO_PEOPLE_ENRICH_ENDPOINT = 'https://api.apollo.io/api/v1/people/match';
const APOLLO_CONFIDENCE_BPS = 8500;
const APOLLO_TIMEOUT_MS = 10_000;
const APOLLO_CONCURRENCY = 5;
const APOLLO_MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_EXECUTIVE_TITLES = [
  'chief executive officer',
  'chief financial officer',
  'chief operating officer',
  'chief technology officer',
  'chief information officer',
  'chief security officer',
  'chief marketing officer',
  'chief revenue officer',
  'president',
  'vice president',
];
const DEFAULT_EXECUTIVE_SENIORITIES = ['owner', 'founder', 'c_suite', 'vp', 'head'];

export const ApolloEnrichJobData = z.object({
  orgId: z.string().uuid(),
  companyName: z.string().min(1),
  domain: z.string().min(1).optional(),
  signature: z.string().min(1).optional(),
});

export type ApolloEnrichJobData = z.infer<typeof ApolloEnrichJobData>;

// The subset of Apollo's organization payload we consume. Apollo's response
// has many other fields; we permissively .passthrough() and only require what
// we map. Numbers come through as `unknown` because Apollo occasionally
// stringifies them — coerce defensively.
const ApolloOrganization = z
  .object({
    name: z.string().nullish(),
    primary_domain: z.string().nullish(),
    website_url: z.string().nullish(),
    industry: z.string().nullish(),
    estimated_num_employees: z.union([z.number(), z.string()]).nullish(),
    // Apollo returns revenue under `annual_revenue` on some plans/endpoints and
    // `organization_revenue` on others (verified live: bulk enrich returns the
    // latter). Accept both so revenue is never silently dropped.
    annual_revenue: z.union([z.number(), z.string()]).nullish(),
    organization_revenue: z.union([z.number(), z.string()]).nullish(),
    founded_year: z.union([z.number(), z.string()]).nullish(),
    logo_url: z.string().nullish(),
    organization_industries: z.array(z.string()).nullish(),
    former_names: z.array(z.string()).nullish(),
    id: z.union([z.string(), z.number()]).nullish(),
    organization_id: z.union([z.string(), z.number()]).nullish(),
    apollo_id: z.union([z.string(), z.number()]).nullish(),
    linkedin_url: z.string().nullish(),
    short_description: z.string().nullish(),
    technologies: z.unknown().optional(),
    current_technologies: z.unknown().optional(),
    organization_technologies: z.unknown().optional(),
    employee_count_by_month: z.unknown().optional(),
    headcount_growth: z.unknown().optional(),
    intent_topics: z.unknown().optional(),
    buying_intent: z.unknown().optional(),
    intent_signals: z.unknown().optional(),
    job_postings: z.unknown().optional(),
    senior_leadership: z.unknown().optional(),
    leadership_changes: z.unknown().optional(),
    funding_events: z.unknown().optional(),
    latest_funding_round_date: z.unknown().optional(),
    total_funding: z.union([z.number(), z.string()]).nullish(),
  })
  .passthrough();

const ApolloResponse = z
  .object({ organization: ApolloOrganization.optional() })
  .passthrough()
  .transform((payload) => {
    if (payload.organization) return { organization: payload.organization };
    return { organization: ApolloOrganization.parse(payload) };
  });

const ApolloPeopleSearchResponse = z
  .object({
    people: z.array(z.unknown()).optional(),
    contacts: z.array(z.unknown()).optional(),
  })
  .passthrough();

const ApolloPeopleEnrichResponse = z
  .object({
    person: z.unknown().optional(),
  })
  .passthrough();

export type ApolloOrganization = z.infer<typeof ApolloOrganization>;

export interface MappedEnrichment {
  legalName: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenueMicros: bigint | null;
  incorporationDate: Date | null;
  logoUrl: string | null;
  industryCodes: string[];
  formerNames: string[];
  strategicIntel: ApolloStrategicIntel;
  technicalStack: Array<{ name: string; source: string; confidence: number }>;
}

type ApolloSyncMode =
  | 'apollo_mcp_company_search'
  | 'apollo_mcp_get_company'
  | 'apollo_api_organization_enrich';

type ApolloCreditPolicy = 'free_search' | 'uses_credits' | 'mixed' | 'unknown';

interface ApolloStrategicSignal {
  id: string;
  kind:
    | 'intent'
    | 'hiring'
    | 'headcount'
    | 'revenue'
    | 'funding'
    | 'leadership'
    | 'technology'
    | 'news'
    | 'risk'
    | 'other';
  label: string;
  detail: string | null;
  observedAt: string;
  source: string;
  confidence: number;
  url: string | null;
  metadata: Record<string, unknown>;
}

interface ApolloStrategicIntel {
  provider: 'apollo_io';
  lastSyncedAt: string;
  syncMode: ApolloSyncMode;
  creditPolicy: ApolloCreditPolicy;
  freshness: 'fresh';
  employeeTrend: 'hiring' | 'contracting' | 'flat' | 'unknown';
  employeeCount: number | null;
  annualRevenueMicros: number | null;
  intentTopics: string[];
  hiringSignals: ApolloStrategicSignal[];
  leadershipSignals: ApolloStrategicSignal[];
  revenueSignals: ApolloStrategicSignal[];
  summary: string;
  limitations: string[];
  signals: ApolloStrategicSignal[];
}

interface ApolloSignaturePayload {
  orgId: string;
  companyName: string;
  domain?: string;
}

/**
 * Pure mapping from Apollo's response shape to CompanyEnrichment fields.
 * Exported so the test can verify mapping without spinning up Redis.
 */
export function mapApolloOrganization(
  org: ApolloOrganization,
  context: {
    syncMode?: ApolloSyncMode;
    creditPolicy?: ApolloCreditPolicy;
    now?: Date;
    jobPostings?: unknown;
    executives?: unknown;
  } = {},
): MappedEnrichment {
  const now = context.now ?? new Date();
  const employees = coerceInt(org.estimated_num_employees);
  const revenue = coerceNumber(org.annual_revenue ?? org.organization_revenue);
  const foundedYear = coerceInt(org.founded_year);
  const jobPostings = context.jobPostings ?? org.job_postings;
  const executives = context.executives ?? org.senior_leadership ?? org.leadership_changes;
  const technicalStack = extractTechnologyStack(org);
  const annualRevenueMicros = revenue === null ? null : BigInt(Math.round(revenue * 1_000_000));
  const strategicIntel = buildApolloStrategicIntel({
    org,
    now,
    employeeCount: employees,
    annualRevenueMicros,
    syncMode: context.syncMode ?? 'apollo_api_organization_enrich',
    creditPolicy: context.creditPolicy ?? 'uses_credits',
    jobPostings,
    executives,
  });

  return {
    legalName: org.name ?? null,
    domain: normalizeDomain(org.primary_domain ?? null),
    website: org.website_url ?? null,
    industry: org.industry ?? null,
    employeeCount: employees,
    // Money in micros per Twenty/Stripe convention (CLAUDE.md).
    annualRevenueMicros,
    // Apollo only exposes founded_year — anchor on Jan 1 of that year.
    incorporationDate:
      foundedYear && foundedYear > 1700 && foundedYear < 3000
        ? new Date(Date.UTC(foundedYear, 0, 1))
        : null,
    logoUrl: org.logo_url ?? null,
    industryCodes: (org.organization_industries ?? []).filter(
      (item): item is string => typeof item === 'string',
    ),
    formerNames: (org.former_names ?? []).filter(
      (item): item is string => typeof item === 'string',
    ),
    strategicIntel,
    technicalStack,
  };
}

function buildApolloStrategicIntel({
  org,
  now,
  employeeCount,
  annualRevenueMicros,
  syncMode,
  creditPolicy,
  jobPostings,
  executives,
}: {
  org: ApolloOrganization;
  now: Date;
  employeeCount: number | null;
  annualRevenueMicros: bigint | null;
  syncMode: ApolloSyncMode;
  creditPolicy: ApolloCreditPolicy;
  jobPostings: unknown;
  executives: unknown;
}): ApolloStrategicIntel {
  const observedAt = now.toISOString();
  const intentTopics = extractIntentTopics(org);
  const hiringSignals = extractHiringSignals(jobPostings, org, observedAt);
  const leadershipSignals = extractLeadershipSignals(executives, observedAt);
  const revenueSignals = extractRevenueSignals(org, annualRevenueMicros, observedAt);
  const technologySignals = extractTechnologyStack(org)
    .slice(0, 8)
    .map((tech, index) =>
      signal({
        id: `apollo-technology-${slug(tech.name)}-${index}`,
        kind: 'technology',
        label: tech.name,
        detail: 'Technology detected by Apollo company intelligence.',
        observedAt,
        confidence: tech.confidence,
        metadata: { source: tech.source },
      }),
    );
  const intentSignals = intentTopics.map((topic, index) =>
    signal({
      id: `apollo-intent-${slug(topic)}-${index}`,
      kind: 'intent',
      label: topic,
      detail: 'Company-level buying intent topic from Apollo.',
      observedAt,
      confidence: 0.78,
    }),
  );
  const signals = [
    ...intentSignals,
    ...hiringSignals,
    ...leadershipSignals,
    ...revenueSignals,
    ...technologySignals,
  ];
  const employeeTrend = deriveEmployeeTrend(hiringSignals, org);
  const summaryParts = [
    intentTopics.length ? `${intentTopics.length} intent topic(s)` : null,
    employeeCount ? `${employeeCount.toLocaleString()} employees` : null,
    hiringSignals.length ? `${hiringSignals.length} hiring signal(s)` : null,
    leadershipSignals.length ? `${leadershipSignals.length} leadership signal(s)` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    provider: 'apollo_io',
    lastSyncedAt: observedAt,
    syncMode,
    creditPolicy,
    freshness: 'fresh',
    employeeTrend,
    employeeCount,
    annualRevenueMicros: annualRevenueMicros === null ? null : Number(annualRevenueMicros),
    intentTopics,
    hiringSignals,
    leadershipSignals,
    revenueSignals,
    summary: summaryParts.length
      ? `Apollo synced ${summaryParts.join(', ')}.`
      : 'Apollo synced company profile; no strategic signals returned yet.',
    limitations: [
      'Apollo MCP company search is credit-free; enrichment and job postings can consume credits depending on plan and tool.',
      'Emails and phone numbers are intentionally excluded from BidStack Apollo account intelligence.',
    ],
    signals,
  };
}

function getJobSigningSecret(): string | null {
  return process.env.BIDSTACK_JOB_SIGNING_SECRET ?? process.env.JOB_SIGNING_SECRET ?? null;
}

function canonicalApolloJobPayload(job: ApolloSignaturePayload): string {
  return JSON.stringify({
    orgId: job.orgId,
    companyName: job.companyName,
    domain: job.domain ?? null,
  });
}

export function createApolloEnrichJobSignature(
  job: ApolloSignaturePayload,
  secret: string,
): string {
  return createHmac('sha256', secret).update(canonicalApolloJobPayload(job)).digest('hex');
}

export function verifyApolloEnrichJobSignature(
  job: ApolloEnrichJobData,
  options: { secret?: string | null; nodeEnv?: string } = {},
): boolean {
  const secret = Object.prototype.hasOwnProperty.call(options, 'secret')
    ? (options.secret ?? null)
    : getJobSigningSecret();
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (!secret) return nodeEnv !== 'production';
  if (!job.signature) return false;

  const expected = createApolloEnrichJobSignature(job, secret);
  const actualBuffer = Buffer.from(job.signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function coerceInt(value: unknown): number | null {
  const n = coerceNumber(value);
  return n === null ? null : Math.trunc(n);
}

function normalizeDomain(domain: string | null): string | null {
  if (!domain) return null;
  // Lowercase first so the `^www\.` strip catches `WWW.` too.
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

// Mirrors the normalization in apps/api/src/routes/crm.ts so the upsert
// targets the same row whether the API or the worker writes it.
export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function signal({
  id,
  kind,
  label,
  detail = null,
  observedAt,
  source = 'apollo_io',
  confidence = 0.75,
  url = null,
  metadata = {},
}: Omit<ApolloStrategicSignal, 'source' | 'detail' | 'confidence' | 'url' | 'metadata'> &
  Partial<
    Pick<ApolloStrategicSignal, 'source' | 'detail' | 'confidence' | 'url' | 'metadata'>
  >): ApolloStrategicSignal {
  return {
    id,
    kind,
    label,
    detail,
    observedAt,
    source,
    confidence: Math.max(0, Math.min(1, confidence)),
    url: validUrl(url),
    metadata: sanitizeApolloPayload(metadata) as Record<string, unknown>,
  };
}

function extractIntentTopics(org: ApolloOrganization): string[] {
  return uniqueStrings([
    ...labelsFromUnknown(org.intent_topics),
    ...labelsFromUnknown(org.buying_intent),
    ...labelsFromUnknown(org.intent_signals),
  ]).slice(0, 12);
}

function extractTechnologyStack(
  org: ApolloOrganization,
): Array<{ name: string; source: string; confidence: number }> {
  return uniqueStrings([
    ...labelsFromUnknown(org.technologies),
    ...labelsFromUnknown(org.current_technologies),
    ...labelsFromUnknown(org.organization_technologies),
  ])
    .slice(0, 24)
    .map((name) => ({ name, source: 'apollo_io', confidence: 0.82 }));
}

function extractHiringSignals(
  jobPostings: unknown,
  org: ApolloOrganization,
  observedAt: string,
): ApolloStrategicSignal[] {
  const rows = rowsFromUnknown(jobPostings).slice(0, 10);
  const jobSignals = rows
    .map((row, index) => {
      const title = firstString(row, ['title', 'job_title', 'name', 'role']);
      if (!title) return null;
      const department = firstString(row, ['department', 'team', 'function']);
      const postedAt = firstString(row, ['posted_at', 'created_at', 'listed_at']);
      return signal({
        id: `apollo-hiring-${slug(title)}-${index}`,
        kind: 'hiring',
        label: title,
        detail: department ? `Hiring in ${department}` : 'Open job posting detected.',
        observedAt: stringDate(postedAt) ?? observedAt,
        confidence: 0.76,
        url: firstString(row, ['url', 'job_url', 'source_url']),
        metadata: row,
      });
    })
    .filter((item): item is ApolloStrategicSignal => item !== null);

  const growthLabels = labelsFromUnknown(org.headcount_growth);
  const growthSignals = growthLabels.slice(0, 3).map((label, index) =>
    signal({
      id: `apollo-headcount-${slug(label)}-${index}`,
      kind: 'headcount',
      label,
      detail: 'Headcount movement returned by Apollo.',
      observedAt,
      confidence: 0.68,
    }),
  );

  return [...jobSignals, ...growthSignals];
}

function extractLeadershipSignals(
  executives: unknown,
  observedAt: string,
): ApolloStrategicSignal[] {
  return rowsFromUnknown(executives)
    .map((row, index) => {
      const name = firstString(row, ['name', 'full_name', 'person_name']);
      const title = firstString(row, ['title', 'job_title', 'headline', 'new_title']);
      if (!title || !isExecutiveTitle(title)) return null;
      const change = firstString(row, ['change', 'change_type', 'event', 'reason']);
      return signal({
        id: `apollo-leadership-${slug(name ?? title)}-${index}`,
        kind: 'leadership',
        label: name ? `${name} - ${title}` : title,
        detail: change ?? 'Executive or senior leadership signal returned by Apollo.',
        observedAt:
          stringDate(firstString(row, ['observed_at', 'updated_at', 'created_at'])) ?? observedAt,
        confidence: 0.72,
        url: firstString(row, ['linkedin_url', 'url', 'source_url']),
        metadata: row,
      });
    })
    .filter((item): item is ApolloStrategicSignal => item !== null)
    .slice(0, 8);
}

function extractRevenueSignals(
  org: ApolloOrganization,
  annualRevenueMicros: bigint | null,
  observedAt: string,
): ApolloStrategicSignal[] {
  const signals: ApolloStrategicSignal[] = [];
  if (annualRevenueMicros !== null) {
    signals.push(
      signal({
        id: 'apollo-revenue-annual',
        kind: 'revenue',
        label: 'Annual revenue returned',
        detail: 'Apollo returned company annual revenue.',
        observedAt,
        confidence: 0.78,
        metadata: { annualRevenueMicros: Number(annualRevenueMicros) },
      }),
    );
  }
  const totalFunding = coerceNumber(org.total_funding);
  if (totalFunding !== null) {
    signals.push(
      signal({
        id: 'apollo-funding-total',
        kind: 'funding',
        label: 'Funding total returned',
        detail: 'Apollo returned total funding data.',
        observedAt: stringDate(org.latest_funding_round_date) ?? observedAt,
        confidence: 0.75,
        metadata: { totalFunding },
      }),
    );
  }
  return signals;
}

function deriveEmployeeTrend(
  hiringSignals: ApolloStrategicSignal[],
  org: ApolloOrganization,
): ApolloStrategicIntel['employeeTrend'] {
  if (hiringSignals.some((item) => item.kind === 'hiring')) return 'hiring';
  const growthText = labelsFromUnknown(org.headcount_growth).join(' ').toLowerCase();
  if (/\b(down|declin|reduc|layoff|contract)/.test(growthText)) return 'contracting';
  if (/\b(up|grow|expand|hiring|increase)/.test(growthText)) return 'hiring';
  return growthText ? 'flat' : 'unknown';
}

function rowsFromUnknown(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(record).filter((row) => Object.keys(row).length);
  const root = record(value);
  for (const key of [
    'items',
    'results',
    'data',
    'companies',
    'organizations',
    'people',
    'contacts',
    'job_postings',
    'jobs',
  ]) {
    const rows = root[key];
    if (Array.isArray(rows)) return rows.map(record).filter((row) => Object.keys(row).length);
  }
  return Object.keys(root).length ? [root] : [];
}

function labelsFromUnknown(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => labelsFromUnknown(item));
  }
  const row = record(value);
  const label = firstString(row, [
    'label',
    'name',
    'title',
    'topic',
    'keyword',
    'technology',
    'technology_name',
    'uid',
  ]);
  return label ? [label] : [];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function validUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function slug(value: string): string {
  return normalizeName(value).slice(0, 80) || 'signal';
}

function isExecutiveTitle(title: string): boolean {
  return /\b(chief|ceo|cfo|coo|cto|cio|ciso|cpo|cro|cmo|president|managing director|general manager|vp|vice president|svp|evp)\b/i.test(
    title,
  );
}

export function sanitizeApolloPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeApolloPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isSensitiveApolloKey(key))
      .map(([key, item]) => [key, sanitizeApolloPayload(item)]),
  );
}

function isSensitiveApolloKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('email') ||
    normalized.includes('phone') ||
    normalized.includes('mobile') ||
    normalized.includes('dial') ||
    normalized === 'contact'
  );
}

export interface CallApolloOptions {
  apiKey: string;
  companyName: string;
  domain?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface CallApolloPeopleSearchOptions {
  apiKey: string;
  domain: string;
  companyName?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  perPage?: number;
  titles?: string[];
  seniorities?: string[];
}

export interface CallApolloPeopleEnrichOptions {
  apiKey: string;
  domain: string;
  personId?: string;
  name?: string;
  linkedinUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface CallApolloMcpOptions {
  url: string;
  bearerToken?: string;
  companyName: string;
  domain?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  includeCreditTools?: boolean;
  includeExecutiveSearch?: boolean;
  tools?: Partial<ApolloMcpToolNames>;
}

interface ApolloMcpToolNames {
  searchCompanies: string;
  getCompany: string;
  getJobPostings: string;
  searchPeople: string;
}

interface ApolloMcpCompanyIntel {
  organization: ApolloOrganization;
  syncMode: Extract<ApolloSyncMode, 'apollo_mcp_company_search' | 'apollo_mcp_get_company'>;
  creditPolicy: ApolloCreditPolicy;
  jobPostings: unknown;
  executives: unknown;
  raw: Record<string, unknown>;
}

/**
 * Calls Apollo's /v1/organizations/enrich and returns the parsed organization.
 * Throws on non-2xx, network failure, or schema mismatch.
 */
export async function callApolloEnrich(options: CallApolloOptions): Promise<ApolloOrganization> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!options.domain) {
    throw new Error('apollo /organizations/enrich requires a company domain');
  }
  const url = new URL(APOLLO_ENDPOINT);
  url.searchParams.set('domain', normalizeDomain(options.domain) ?? options.domain);

  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      'Cache-Control': 'no-cache',
      'X-Api-Key': options.apiKey,
    },
    signal: options.signal ?? AbortSignal.timeout(APOLLO_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`apollo /organizations/enrich ${res.status}: ${text.slice(0, 200)}`);
  }

  const json: unknown = await res.json();
  const parsed = ApolloResponse.parse(json);
  return parsed.organization;
}

export async function callApolloPeopleSearch(
  options: CallApolloPeopleSearchOptions,
): Promise<z.infer<typeof ApolloPeopleSearchResponse>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const domain = normalizeDomain(options.domain);
  if (!domain) throw new Error('apollo people search requires a company domain');

  const url = new URL(APOLLO_PEOPLE_SEARCH_ENDPOINT);
  appendSearchParam(url, 'q_organization_domains_list[]', domain);
  for (const seniority of options.seniorities ?? DEFAULT_EXECUTIVE_SENIORITIES) {
    appendSearchParam(url, 'person_seniorities[]', seniority);
  }
  for (const title of options.titles ?? DEFAULT_EXECUTIVE_TITLES) {
    appendSearchParam(url, 'person_titles[]', title);
  }
  url.searchParams.set('include_similar_titles', 'false');
  url.searchParams.set('page', '1');
  url.searchParams.set('per_page', String(Math.max(1, Math.min(25, options.perPage ?? 10))));

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: apolloApiHeaders(options.apiKey),
    signal: options.signal ?? AbortSignal.timeout(APOLLO_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`apollo /mixed_people/api_search ${res.status}: ${text.slice(0, 200)}`);
  }

  return ApolloPeopleSearchResponse.parse(await res.json());
}

export async function callApolloPeopleEnrich(
  options: CallApolloPeopleEnrichOptions,
): Promise<z.infer<typeof ApolloPeopleEnrichResponse>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const domain = normalizeDomain(options.domain);
  if (!domain) throw new Error('apollo people enrichment requires a company domain');
  if (!options.personId && !options.name && !options.linkedinUrl) {
    throw new Error('apollo people enrichment requires personId, name, or linkedinUrl');
  }

  const url = new URL(APOLLO_PEOPLE_ENRICH_ENDPOINT);
  url.searchParams.set('domain', domain);
  if (options.personId) url.searchParams.set('id', options.personId);
  if (options.name) url.searchParams.set('name', options.name);
  if (options.linkedinUrl) url.searchParams.set('linkedin_url', options.linkedinUrl);
  // Hard guardrail: we use person enrichment only to confirm current title/
  // employer. Do not request email, phone, or waterfall contact enrichment.
  url.searchParams.set('reveal_personal_emails', 'false');
  url.searchParams.set('reveal_phone_number', 'false');
  url.searchParams.set('run_waterfall_email', 'false');
  url.searchParams.set('run_waterfall_phone', 'false');

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: apolloApiHeaders(options.apiKey),
    signal: options.signal ?? AbortSignal.timeout(APOLLO_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`apollo /people/match ${res.status}: ${text.slice(0, 200)}`);
  }

  return ApolloPeopleEnrichResponse.parse(await res.json());
}

function apolloApiHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
    // Apollo API docs expose Bearer credentials on reference pages. Some
    // existing Apollo endpoints in this worker use X-Api-Key, so send both
    // with the same secret to keep old and current auth surfaces compatible.
    Authorization: `Bearer ${apiKey}`,
    'X-Api-Key': apiKey,
  };
}

function appendSearchParam(url: URL, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed) url.searchParams.append(key, trimmed);
}

export async function callApolloMcpCompanyIntel(
  options: CallApolloMcpOptions,
): Promise<ApolloMcpCompanyIntel> {
  const tools = {
    searchCompanies: 'search_companies',
    getCompany: 'get_company',
    getJobPostings: 'get_job_postings',
    searchPeople: 'search_people',
    ...options.tools,
  };
  const client = new ApolloMcpClient({
    url: options.url,
    bearerToken: options.bearerToken,
    timeoutMs: options.timeoutMs ?? APOLLO_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
  });

  const searchResult = await client.callTool(tools.searchCompanies, {
    query: options.companyName,
    ...(options.domain ? { domain: options.domain, domains: [options.domain] } : {}),
    limit: 5,
  });
  const searchOrganization = pickApolloOrganization(
    searchResult,
    options.domain,
    options.companyName,
  );
  let organization = searchOrganization;
  let syncMode: ApolloMcpCompanyIntel['syncMode'] = 'apollo_mcp_company_search';
  const organizationId = apolloOrganizationId(searchOrganization);
  let companyResult: unknown = null;

  if (organizationId || options.domain) {
    try {
      companyResult = await client.callTool(tools.getCompany, {
        ...(organizationId
          ? { id: organizationId, company_id: organizationId, organization_id: organizationId }
          : {}),
        ...(options.domain ? { domain: options.domain } : {}),
        name: options.companyName,
      });
      organization = {
        ...searchOrganization,
        ...pickApolloOrganization(companyResult, options.domain, options.companyName),
      };
      syncMode = 'apollo_mcp_get_company';
    } catch {
      // Company search is enough for credit-safe firmographics; get-company may
      // be unavailable depending on Apollo plan/connector naming.
    }
  }

  let jobPostings: unknown = null;
  let creditPolicy: ApolloCreditPolicy = 'free_search';
  if (options.includeCreditTools && (organizationId || options.domain)) {
    try {
      jobPostings = await client.callTool(tools.getJobPostings, {
        ...(organizationId ? { company_id: organizationId, organization_id: organizationId } : {}),
        ...(options.domain ? { domain: options.domain } : {}),
        limit: 25,
      });
      creditPolicy = 'mixed';
    } catch {
      jobPostings = null;
    }
  }

  let executives: unknown = null;
  if (options.includeExecutiveSearch !== false && options.domain) {
    try {
      executives = await client.callTool(tools.searchPeople, {
        q_organization_domains_list: [options.domain],
        person_titles: DEFAULT_EXECUTIVE_TITLES,
        person_seniorities: DEFAULT_EXECUTIVE_SENIORITIES,
        limit: 10,
      });
    } catch {
      executives = null;
    }
  }

  return {
    organization,
    syncMode,
    creditPolicy,
    jobPostings,
    executives,
    raw: {
      searchResult: sanitizeApolloPayload(searchResult),
      companyResult: sanitizeApolloPayload(companyResult),
      jobPostings: sanitizeApolloPayload(jobPostings),
      executives: sanitizeApolloPayload(executives),
    },
  };
}

class ApolloMcpClient {
  private readonly url: string;
  private readonly bearerToken: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private sessionId: string | undefined;
  private initialized = false;
  private nextId = 1;

  constructor({
    url,
    bearerToken,
    timeoutMs,
    fetchImpl,
  }: {
    url: string;
    bearerToken?: string;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
  }) {
    this.url = url;
    this.bearerToken = bearerToken;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const raw = await this.rpc('tools/call', { name, arguments: args });
    const result = record(raw);
    if (result.isError === true) {
      const content = rowsFromUnknown(result.content);
      const message = firstString(content[0] ?? {}, ['text']) ?? `Apollo MCP tool ${name} failed`;
      throw new Error(message);
    }
    if (result.structuredContent !== undefined) return result.structuredContent;
    const content = rowsFromUnknown(result.content);
    const text = firstString(content[0] ?? {}, ['text']);
    if (!text) return raw;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc(
      'initialize',
      {
        protocolVersion: APOLLO_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'bidstack-apollo-client', version: '0.1.0' },
      },
      { skipInit: true },
    );
    this.initialized = true;
    try {
      await this.notify('notifications/initialized');
    } catch {
      // Non-fatal for stateless MCP gateways.
    }
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    opts: { skipInit?: boolean } = {},
  ): Promise<unknown> {
    if (!opts.skipInit) await this.initialize();
    const id = this.nextId++;
    const response = await this.postJsonRpc({ jsonrpc: '2.0', id, method, params }, false);
    const envelope = record(response);
    if (record(envelope.error).message) {
      throw new Error(String(record(envelope.error).message));
    }
    return envelope.result;
  }

  private async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.postJsonRpc({ jsonrpc: '2.0', method, params }, true);
  }

  private async postJsonRpc(
    body: Record<string, unknown>,
    notification: boolean,
  ): Promise<unknown> {
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const sessionId =
      response.headers.get('Mcp-Session-Id') ?? response.headers.get('mcp-session-id');
    if (sessionId && !this.sessionId) this.sessionId = sessionId;
    if (notification && response.status === 202) return undefined;
    if (!response.ok) {
      throw new Error(`apollo-mcp HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) return readJsonFromEventStream(response);
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': APOLLO_MCP_PROTOCOL_VERSION,
    };
    if (this.bearerToken) headers.Authorization = `Bearer ${this.bearerToken}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }
}

async function readJsonFromEventStream(response: Response): Promise<unknown> {
  const text = await response.text();
  const frames = text.split(/\n\n+/);
  for (const frame of frames.reverse()) {
    const dataLine = frame
      .split(/\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const payload = dataLine.slice('data:'.length).trim();
    if (!payload) continue;
    const parsed = JSON.parse(payload) as unknown;
    const envelope = record(parsed);
    if ('result' in envelope || 'error' in envelope) return parsed;
  }
  throw new Error('apollo-mcp returned an empty event stream');
}

function pickApolloOrganization(
  result: unknown,
  domain?: string,
  name?: string,
): ApolloOrganization {
  const root = record(result);
  const direct = root.organization ?? root.company ?? root.account;
  if (direct) return ApolloOrganization.parse(direct);
  const rows = rowsFromUnknown(result);
  const normalizedDomain = normalizeDomain(domain ?? null);
  const normalizedName = name ? normalizeName(name) : null;
  const match =
    rows.find((row) => {
      const rowDomain = normalizeDomain(
        firstString(row, ['primary_domain', 'domain', 'website_url', 'website']),
      );
      return normalizedDomain && rowDomain === normalizedDomain;
    }) ??
    rows.find((row) => {
      const rowName = firstString(row, ['name', 'organization_name', 'company_name']);
      return normalizedName && rowName && normalizeName(rowName) === normalizedName;
    }) ??
    rows[0];
  if (!match) throw new Error('Apollo MCP returned no matching company');
  return ApolloOrganization.parse(match);
}

function apolloOrganizationId(org: ApolloOrganization): string | null {
  const value = org.id ?? org.organization_id ?? org.apollo_id;
  return value === null || value === undefined ? null : String(value);
}

function apolloPersonId(row: Record<string, unknown>): string | null {
  const value = row.id ?? row.person_id ?? row.apollo_id;
  return value === null || value === undefined ? null : String(value);
}

function mergePeoplePayloads(
  primary: unknown,
  enrichment: unknown,
): { people: Record<string, unknown>[] } {
  return {
    people: [...rowsFromUnknown(primary), ...peopleRowsFromEnrichment(enrichment)].map(
      (row) => sanitizeApolloPayload(row) as Record<string, unknown>,
    ),
  };
}

function peopleRowsFromEnrichment(value: unknown): Record<string, unknown>[] {
  const root = record(value);
  const person = record(root.person);
  if (Object.keys(person).length) return [person];
  return rowsFromUnknown(value);
}

export async function startCompanyEnrichApollo(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<{ queue: Queue; worker: Worker }> {
  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: COMPANY_ENRICH_APOLLO.defaultJobOptions,
  });
  queues.push(queue);

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const data = ApolloEnrichJobData.parse(job.data);
      const jobLog = log.child({ queue: QUEUE_NAME, jobId: job.id, orgId: data.orgId });
      if (!verifyApolloEnrichJobSignature(data)) {
        jobLog.warn({ companyName: data.companyName }, 'apollo enrichment job signature rejected');
        throw new Error('Invalid Apollo enrichment job signature');
      }

      const apolloMcpUrl = process.env.APOLLO_MCP_URL;
      const apiKey = process.env.APOLLO_API_KEY;
      let organization: ApolloOrganization;
      let syncMode: ApolloSyncMode;
      let creditPolicy: ApolloCreditPolicy;
      let rawMcp: Record<string, unknown> | null = null;
      let rawPeopleSearch: unknown = null;
      let rawPeopleEnrichment: unknown = null;
      let jobPostings: unknown = null;
      let executives: unknown = null;

      if (apolloMcpUrl) {
        const mcpIntel = await callApolloMcpCompanyIntel({
          url: apolloMcpUrl,
          bearerToken: process.env.APOLLO_MCP_BEARER_TOKEN,
          companyName: data.companyName,
          ...(data.domain ? { domain: data.domain } : {}),
          timeoutMs: Number(process.env.APOLLO_MCP_TIMEOUT_MS ?? APOLLO_TIMEOUT_MS),
          includeCreditTools: process.env.APOLLO_MCP_ENABLE_CREDIT_TOOLS === 'true',
          includeExecutiveSearch: process.env.APOLLO_MCP_ENABLE_EXECUTIVE_SEARCH !== 'false',
          tools: {
            searchCompanies: process.env.APOLLO_MCP_SEARCH_COMPANIES_TOOL ?? 'search_companies',
            getCompany: process.env.APOLLO_MCP_GET_COMPANY_TOOL ?? 'get_company',
            getJobPostings: process.env.APOLLO_MCP_GET_JOB_POSTINGS_TOOL ?? 'get_job_postings',
            searchPeople: process.env.APOLLO_MCP_SEARCH_PEOPLE_TOOL ?? 'search_people',
          },
        });
        organization = mcpIntel.organization;
        syncMode = mcpIntel.syncMode;
        creditPolicy = mcpIntel.creditPolicy;
        rawMcp = mcpIntel.raw;
        jobPostings = mcpIntel.jobPostings;
        executives = mcpIntel.executives;
      } else if (!apiKey || !data.domain) {
        jobLog.warn(
          { companyName: data.companyName, hasDomain: Boolean(data.domain) },
          'Apollo enrichment is a no-op: configure APOLLO_MCP_URL, or APOLLO_API_KEY with a domain',
        );
        return { skipped: true, reason: 'Apollo MCP/API not configured' };
      } else {
        organization = await callApolloEnrich({
          apiKey,
          companyName: data.companyName,
          domain: data.domain,
        });
        syncMode = 'apollo_api_organization_enrich';
        creditPolicy = 'uses_credits';
        if (process.env.APOLLO_API_ENABLE_PEOPLE_SEARCH !== 'false') {
          try {
            const peopleSearch = await callApolloPeopleSearch({
              apiKey,
              companyName: data.companyName,
              domain: data.domain,
              perPage: Number(process.env.APOLLO_API_PEOPLE_SEARCH_PER_PAGE ?? 10),
            });
            rawPeopleSearch = peopleSearch;
            executives = peopleSearch;

            if (process.env.APOLLO_API_ENABLE_PEOPLE_ENRICHMENT === 'true') {
              const firstExecutive = rowsFromUnknown(peopleSearch).find((row) =>
                isExecutiveTitle(firstString(row, ['title', 'job_title', 'headline']) ?? ''),
              );
              if (firstExecutive) {
                try {
                  const enrichInput: CallApolloPeopleEnrichOptions = {
                    apiKey,
                    domain: data.domain,
                  };
                  const personId = apolloPersonId(firstExecutive);
                  const personName = firstString(firstExecutive, [
                    'name',
                    'full_name',
                    'person_name',
                  ]);
                  const linkedinUrl = firstString(firstExecutive, ['linkedin_url']);
                  if (personId) enrichInput.personId = personId;
                  if (personName) enrichInput.name = personName;
                  if (linkedinUrl) enrichInput.linkedinUrl = linkedinUrl;
                  const enriched = await callApolloPeopleEnrich(enrichInput);
                  rawPeopleEnrichment = enriched;
                  executives = mergePeoplePayloads(peopleSearch, enriched);
                  creditPolicy = 'mixed';
                } catch (err) {
                  jobLog.warn(
                    { err, companyName: data.companyName, domain: data.domain },
                    'Apollo people enrichment skipped; continuing with people search results',
                  );
                }
              }
            }
          } catch (err) {
            jobLog.warn(
              { err, companyName: data.companyName, domain: data.domain },
              'Apollo people search failed; continuing with company enrichment only',
            );
          }
        }
      }

      const mapped = mapApolloOrganization(organization, {
        syncMode,
        creditPolicy,
        jobPostings,
        executives,
      });

      const normalizedName = normalizeName(data.companyName);
      const sourceUrl = mapped.website ?? (mapped.domain ? `https://${mapped.domain}/` : null);
      const nowIso = mapped.strategicIntel.lastSyncedAt;
      const sourceAttribution = [
        {
          source: 'apollo_io',
          label:
            syncMode === 'apollo_api_organization_enrich'
              ? 'Apollo.io organization enrichment'
              : 'Apollo MCP company intelligence',
          sourceUrl,
          fetchedAt: nowIso,
          confidence: 0.85,
          providerMetadata: {
            transport: syncMode.startsWith('apollo_mcp') ? 'mcp_streamable_http' : 'rest_api',
            endpoint: syncMode.startsWith('apollo_mcp') ? '/mcp' : APOLLO_ENDPOINT,
            organizationName: organization.name ?? null,
            creditPolicy,
          },
        },
      ];
      const meetingTechStack =
        mapped.technicalStack.length > 0
          ? [{ label: 'Apollo technologies', items: mapped.technicalStack }]
          : undefined;
      const apolloMetadata = {
        provider: 'apollo_io',
        lastSyncedAt: nowIso,
        syncMode,
        creditPolicy,
        strategicIntel: mapped.strategicIntel,
        limitations: mapped.strategicIntel.limitations,
        rawMcp,
        rawPeopleSearch: sanitizeApolloPayload(rawPeopleSearch),
        rawPeopleEnrichment: sanitizeApolloPayload(rawPeopleEnrichment),
      };

      const enrichment = await prisma.companyEnrichment.upsert({
        where: { orgId_normalizedName: { orgId: data.orgId, normalizedName } },
        create: {
          orgId: data.orgId,
          normalizedName,
          legalName: mapped.legalName ?? data.companyName,
          tradeName: organization.name ?? data.companyName,
          domain: mapped.domain ?? data.domain ?? null,
          website: mapped.website ?? sourceUrl,
          logoUrl: mapped.logoUrl,
          logoSource: mapped.logoUrl ? 'manual' : null,
          registryIds: {},
          formerNames: mapped.formerNames,
          industryCodes: mapped.industryCodes,
          incorporationDate: mapped.incorporationDate,
          employeeCount: mapped.employeeCount,
          annualRevenueMicros: mapped.annualRevenueMicros,
          status: 'active',
          confidenceBps: APOLLO_CONFIDENCE_BPS,
          sourceAttribution: sourceAttribution as Prisma.InputJsonValue,
          providerMetadata: {
            apollo: apolloMetadata,
            apolloOrganization: sanitizeApolloPayload(organization),
            mappedIndustry: mapped.industry,
            ...(meetingTechStack ? { meetingTechStack } : {}),
          } as unknown as Prisma.InputJsonValue,
          cacheExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        update: {
          legalName: mapped.legalName ?? data.companyName,
          tradeName: organization.name ?? data.companyName,
          domain: mapped.domain ?? data.domain ?? null,
          website: mapped.website ?? sourceUrl,
          logoUrl: mapped.logoUrl,
          logoSource: mapped.logoUrl ? 'manual' : null,
          formerNames: mapped.formerNames,
          industryCodes: mapped.industryCodes,
          incorporationDate: mapped.incorporationDate,
          employeeCount: mapped.employeeCount,
          annualRevenueMicros: mapped.annualRevenueMicros,
          status: 'active',
          confidenceBps: APOLLO_CONFIDENCE_BPS,
          sourceAttribution: sourceAttribution as Prisma.InputJsonValue,
          providerMetadata: {
            apollo: apolloMetadata,
            apolloOrganization: sanitizeApolloPayload(organization),
            mappedIndustry: mapped.industry,
            ...(meetingTechStack ? { meetingTechStack } : {}),
          } as unknown as Prisma.InputJsonValue,
          cacheExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const companyMatches: Prisma.CompanyWhereInput[] = [
        { name: { equals: data.companyName, mode: 'insensitive' } },
      ];
      if (mapped.domain) {
        companyMatches.push({ domain: { equals: mapped.domain, mode: 'insensitive' } });
      }

      await prisma.company.updateMany({
        where: {
          orgId: data.orgId,
          deletedAt: null,
          OR: companyMatches,
        },
        data: {
          legalName: mapped.legalName ?? undefined,
          domain: mapped.domain ?? data.domain ?? undefined,
          website: mapped.website ?? undefined,
          logoUrl: mapped.logoUrl ?? undefined,
          industry: mapped.industry ?? undefined,
          employeeCount: mapped.employeeCount ?? undefined,
          source: 'apollo_io',
          confidence: APOLLO_CONFIDENCE_BPS / 10_000,
          enrichedAt: new Date(nowIso),
        },
      });

      await prisma.auditLog.create({
        data: {
          orgId: data.orgId,
          action: 'crm.company.enrich.apollo',
          targetType: 'company_enrichment',
          targetId: enrichment.id,
          diff: {
            companyName: data.companyName,
            domain: mapped.domain,
            employeeCount: mapped.employeeCount,
            syncMode,
            creditPolicy,
          } as Prisma.InputJsonValue,
        },
      });

      jobLog.info(
        { enrichmentId: enrichment.id, employees: mapped.employeeCount },
        'apollo enrichment cache updated',
      );
      return { enrichmentId: enrichment.id };
    },
    { connection, concurrency: APOLLO_CONCURRENCY },
  );
  workers.push(worker);

  return { queue, worker };
}
