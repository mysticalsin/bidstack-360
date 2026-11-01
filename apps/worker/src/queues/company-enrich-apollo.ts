// Apollo.io company enrichment worker.
//
// Job shape: { orgId, companyName, domain? }
// Prefer Apollo MCP company search/get-company when APOLLO_MCP_URL and
// APOLLO_MCP_BEARER_TOKEN are configured.
// Fall back to the REST organization enrichment endpoint only when APOLLO_API_KEY
// is configured and a domain is known.
// Maps the response
// to the CompanyEnrichment row keyed by (orgId, normalizedName), and writes an
// audit log entry. Company revenue is stored as integer micros. Open jobs are
// a posting count. This worker never calls Apollo people or lead endpoints
// and never stores phone numbers or contact leads.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { COMPANY_ENRICH_APOLLO, microsToSafeNumber, unitsToMicros } from '@bidstack/shared';

export const QUEUE_NAME = COMPANY_ENRICH_APOLLO.name;

const APOLLO_ENDPOINT = 'https://api.apollo.io/api/v1/organizations/enrich';
const GDELT_DOC_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';
const APOLLO_TIMEOUT_MS = 10_000;
const APOLLO_CONCURRENCY = 5;
const APOLLO_COMPANY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const APOLLO_MCP_PROTOCOL_VERSION = '2025-06-18';
const OPEN_JOB_COUNT_KEYS = [
  'organization_num_jobs',
  'num_job_postings',
  'job_postings_count',
  'organization_job_postings_count',
  'open_jobs',
  'open_job_count',
] as const;

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
    news: z.unknown().optional(),
    latest_news: z.unknown().optional(),
    press_releases: z.unknown().optional(),
    expansion_signals: z.unknown().optional(),
    investment_signals: z.unknown().optional(),
  })
  .passthrough();

const ApolloResponse = z
  .object({ organization: ApolloOrganization.optional() })
  .passthrough()
  .transform((payload) => {
    if (payload.organization) return { organization: payload.organization };
    return { organization: ApolloOrganization.parse(payload) };
  });

const GdeltDocResponse = z
  .object({
    articles: z.array(z.unknown()).optional(),
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
  technicalStack: Array<{ name: string; source: string; confidence: number | null }>;
}

type ApolloSyncMode =
  | 'apollo_mcp_company_search'
  | 'apollo_mcp_get_company'
  | 'apollo_api_organization_enrich';

type ApolloCreditPolicy = 'uses_credits' | 'mixed' | 'unknown';

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
  confidence: number | null;
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
  /** Null when the company payload did not include a posting count. */
  openJobCount: number | null;
  intentTopics: string[];
  hiringSignals: ApolloStrategicSignal[];
  leadershipSignals: ApolloStrategicSignal[];
  revenueSignals: ApolloStrategicSignal[];
  newsSignals: ApolloStrategicSignal[];
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
    newsCrossCheck?: unknown;
  } = {},
): MappedEnrichment {
  const now = context.now ?? new Date();
  const employees = coerceInt(org.estimated_num_employees);
  const revenue = revenueToMicros(org.annual_revenue ?? org.organization_revenue);
  const foundedYear = coerceInt(org.founded_year);
  const jobPostings = context.jobPostings ?? org.job_postings;
  const executives = context.executives ?? org.senior_leadership ?? org.leadership_changes;
  const technicalStack = extractTechnologyStack(org);
  const annualRevenueMicros = revenue;
  const strategicIntel = buildApolloStrategicIntel({
    org,
    now,
    employeeCount: employees,
    annualRevenueMicros,
    syncMode: context.syncMode ?? 'apollo_api_organization_enrich',
    creditPolicy: context.creditPolicy ?? 'uses_credits',
    jobPostings,
    executives,
    newsCrossCheck: context.newsCrossCheck,
  });

  return {
    // Apollo `name` is the organization label, not a legal-name field.
    legalName: null,
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
  newsCrossCheck,
}: {
  org: ApolloOrganization;
  now: Date;
  employeeCount: number | null;
  annualRevenueMicros: bigint | null;
  syncMode: ApolloSyncMode;
  creditPolicy: ApolloCreditPolicy;
  jobPostings: unknown;
  executives: unknown;
  newsCrossCheck: unknown;
}): ApolloStrategicIntel {
  const observedAt = now.toISOString();
  const intentTopics = extractIntentTopics(org);
  const openJobCount = apolloOpenJobCount(org, jobPostings);
  const hiringSignals = extractHiringSignals(jobPostings, org, observedAt);
  const leadershipSignals = extractLeadershipSignals(executives, observedAt);
  const revenueSignals = extractRevenueSignals(org, annualRevenueMicros, observedAt);
  const newsSignals = extractNewsSignals(org, observedAt, newsCrossCheck);
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
      confidence: null,
    }),
  );
  const signals = [
    ...intentSignals,
    ...hiringSignals,
    ...leadershipSignals,
    ...revenueSignals,
    ...newsSignals,
    ...technologySignals,
  ];
  const employeeTrend = deriveEmployeeTrend(hiringSignals, org);
  const summaryParts = [
    intentTopics.length ? `${intentTopics.length} intent topic(s)` : null,
    employeeCount ? `${employeeCount.toLocaleString()} employees` : null,
    openJobCount !== null ? `${openJobCount.toLocaleString()} open job(s)` : null,
    hiringSignals.length ? `${hiringSignals.length} hiring signal(s)` : null,
    leadershipSignals.length ? `${leadershipSignals.length} leadership signal(s)` : null,
    newsSignals.length ? `${newsSignals.length} news/funding signal(s)` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    provider: 'apollo_io',
    lastSyncedAt: observedAt,
    syncMode,
    creditPolicy,
    freshness: 'fresh',
    employeeTrend,
    employeeCount,
    annualRevenueMicros: microsToSafeNumber(annualRevenueMicros),
    openJobCount,
    intentTopics,
    hiringSignals,
    leadershipSignals,
    revenueSignals,
    newsSignals,
    summary: summaryParts.length
      ? `Apollo synced ${summaryParts.join(', ')}.`
      : 'Apollo synced company profile; no strategic signals returned yet.',
    limitations: [
      'Apollo account intelligence follows the connected Apollo plan and tool limits; credit-sensitive enrichment is opt-in in Polo PreSales.',
      'Phone numbers and contact leads are not requested or stored. A missing revenue or open-job count stays empty.',
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

function revenueToMicros(value: unknown): bigint | null {
  if (typeof value === 'number' || typeof value === 'string') return unitsToMicros(value);
  return null;
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
  confidence = null,
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
    confidence: confidence == null ? null : Math.max(0, Math.min(1, confidence)),
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
): Array<{ name: string; source: string; confidence: null }> {
  return uniqueStrings([
    ...labelsFromUnknown(org.technologies),
    ...labelsFromUnknown(org.current_technologies),
    ...labelsFromUnknown(org.organization_technologies),
  ])
    .slice(0, 24)
    .map((name) => ({ name, source: 'apollo_io', confidence: null }));
}

/**
 * Open-job count from the company payload Apollo already returned.
 * A number field wins. A posting list is counted. People and leads are not.
 * Missing data stays null so callers do not show a made-up zero.
 */
export function apolloOpenJobCount(org: ApolloOrganization, jobPostings?: unknown): number | null {
  const raw = org as unknown as Record<string, unknown>;
  for (const key of OPEN_JOB_COUNT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const count = nonNegativeInt(raw[key]);
    if (count !== null) return count;
  }
  const fromContext = postingCount(jobPostings);
  if (fromContext !== null) return fromContext;
  return postingCount(org.job_postings);
}

function nonNegativeInt(value: unknown): number | null {
  const n = coerceInt(value);
  return n !== null && n >= 0 ? n : null;
}

function postingCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return nonNegativeInt(value);
  if (Array.isArray(value)) {
    const postings = value.filter((row) => isJobPostingRow(record(row)));
    return postings.length > 0 ? postings.length : null;
  }
  const root = record(value);
  if (!Object.keys(root).length) return null;
  const pagination = record(root.pagination);
  const total =
    nonNegativeInt(root.total_entries) ??
    nonNegativeInt(root.total) ??
    nonNegativeInt(root.count) ??
    nonNegativeInt(pagination.total_entries);
  if (total !== null) return total;
  for (const key of ['job_postings', 'jobs', 'organization_job_postings', 'items', 'results', 'data']) {
    if (!Object.prototype.hasOwnProperty.call(root, key)) continue;
    const nested = postingCount(root[key]);
    if (nested !== null) return nested;
  }
  return isJobPostingRow(root) ? 1 : null;
}

function isJobPostingRow(row: Record<string, unknown>): boolean {
  if (!Object.keys(row).length || isContactLeadRow(row)) return false;
  return firstString(row, ['title', 'job_title', 'name', 'role']) !== null;
}

/** A person or contact lead. A job title alone is not enough. */
function isContactLeadRow(row: Record<string, unknown>): boolean {
  return Object.keys(row).some((key) => {
    const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      compact === 'firstname' ||
      compact === 'lastname' ||
      compact === 'lastnameobfuscated' ||
      compact === 'personid' ||
      compact === 'contactid' ||
      compact.includes('email')
    );
  });
}

function extractHiringSignals(
  jobPostings: unknown,
  org: ApolloOrganization,
  observedAt: string,
): ApolloStrategicSignal[] {
  const rows = rowsFromUnknown(jobPostings).slice(0, 10);
  const jobSignals = rows
    .map((row, index) => {
      if (isContactLeadRow(row)) return null;
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
        confidence: null,
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
      confidence: null,
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
        confidence: null,
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
        confidence: null,
        metadata: { annualRevenueMicros: annualRevenueMicros.toString() },
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
        confidence: null,
        metadata: { totalFunding },
      }),
    );
  }
  return signals;
}

function extractNewsSignals(
  org: ApolloOrganization,
  observedAt: string,
  newsCrossCheck?: unknown,
): ApolloStrategicSignal[] {
  const apolloRows = [
    ...rowsFromUnknown(org.news),
    ...rowsFromUnknown(org.latest_news),
    ...rowsFromUnknown(org.press_releases),
    ...rowsFromUnknown(org.expansion_signals),
    ...rowsFromUnknown(org.investment_signals),
    ...rowsFromUnknown(org.funding_events),
  ];
  const crossCheckRows = rowsFromUnknown(newsCrossCheck);
  const rows = [
    ...apolloRows.map((row) => ({ row, source: 'apollo_io' as const })),
    ...crossCheckRows.map((row) => ({ row, source: 'gdelt_news' as const })),
  ];

  return rows
    .map(({ row, source }, index) => {
      const title = firstString(row, [
        'title',
        'headline',
        'name',
        'event',
        'round',
        'funding_round',
        'description',
      ]);
      if (!title) return null;
      const detail =
        firstString(row, ['summary', 'description', 'snippet', 'details', 'amount']) ??
        newsDetailFromTitle(title);
      const observed =
        stringDate(
          firstString(row, [
            'published_at',
            'publishedAt',
            'date',
            'observed_at',
            'created_at',
            'seendate',
          ]),
        ) ?? observedAt;
      const lowerText = `${title} ${detail ?? ''}`.toLowerCase();
      const kind: ApolloStrategicSignal['kind'] =
        /\b(fund|investment|series [a-z]|raise|capital|financing)\b/.test(lowerText)
          ? 'funding'
          : 'news';
      return signal({
        id: `apollo-news-${slug(title)}-${index}`,
        kind,
        label: title,
        detail,
        observedAt: observed,
        source,
        confidence: null,
        url: firstString(row, ['url', 'source_url', 'article_url', 'link']),
        metadata: row,
      });
    })
    .filter((item): item is ApolloStrategicSignal => item !== null)
    .slice(0, 10);
}

function newsDetailFromTitle(title: string): string {
  return /\b(expand|expansion|open|hire|investment|fund|raise|acquir|launch)\b/i.test(title)
    ? 'Company news signal returned by Apollo; use as account-planning context.'
    : 'Company news signal returned by Apollo.';
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
    'job_postings',
    'jobs',
    'articles',
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
  if (Array.isArray(value)) {
    return value
      .filter((item) => !isContactLeadRow(record(item)))
      .map(sanitizeApolloPayload);
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isSensitiveApolloKey(key))
      .map(([key, item]) => [key, sanitizeApolloPayload(item)]),
  );
}

function isSensitiveApolloKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (
    normalized.includes('email') ||
    normalized.includes('phone') ||
    normalized.includes('mobile') ||
    normalized.includes('dial') ||
    normalized.includes('people')
  ) {
    return true;
  }
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  return (
    compact === 'contact' ||
    compact === 'contacts' ||
    compact === 'number' ||
    compact === 'numbers' ||
    compact === 'sanitizednumber' ||
    compact === 'rawnumber' ||
    compact === 'lead' ||
    compact === 'leads'
  );
}

export interface CallApolloOptions {
  apiKey: string;
  companyName: string;
  domain?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface FetchCompanyNewsCrossCheckOptions {
  companyName: string;
  domain?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxRecords?: number;
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
}

interface ApolloMcpCompanyIntel {
  organization: ApolloOrganization;
  syncMode: Extract<ApolloSyncMode, 'apollo_mcp_company_search' | 'apollo_mcp_get_company'>;
  creditPolicy: ApolloCreditPolicy;
  jobPostings: unknown;
  executives: unknown;
  raw: Record<string, unknown>;
}

export type ApolloEnrichmentTransport =
  | { kind: 'mcp'; url: string; bearerToken: string }
  | { kind: 'api'; apiKey: string }
  | { kind: 'none'; reason: string };

export function resolveApolloEnrichmentTransport({
  env = process.env,
  hasDomain,
}: {
  env?: NodeJS.ProcessEnv;
  hasDomain: boolean;
}): ApolloEnrichmentTransport {
  const mcpUrl = env.APOLLO_MCP_URL?.trim();
  const mcpBearerToken = env.APOLLO_MCP_BEARER_TOKEN?.trim();
  if (mcpUrl && mcpBearerToken) {
    return { kind: 'mcp', url: mcpUrl, bearerToken: mcpBearerToken };
  }

  const apiKey = env.APOLLO_API_KEY?.trim();
  if (apiKey && hasDomain) return { kind: 'api', apiKey };

  if (mcpUrl || mcpBearerToken) {
    return {
      kind: 'none',
      reason:
        'Apollo MCP is partially configured; set both APOLLO_MCP_URL and APOLLO_MCP_BEARER_TOKEN, or set APOLLO_API_KEY with a company domain.',
    };
  }

  return {
    kind: 'none',
    reason: hasDomain
      ? 'Apollo MCP/API not configured'
      : 'Apollo REST fallback requires a company domain',
  };
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

export async function fetchCompanyNewsCrossCheck(
  options: FetchCompanyNewsCrossCheckOptions,
): Promise<{
  source: 'gdelt_news';
  query: string;
  fetchedAt: string;
  articles: Record<string, unknown>[];
}> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const companyName = options.companyName.trim();
  if (!companyName) throw new Error('company news cross-check requires a company name');
  const query = buildCompanyNewsQuery(companyName, options.domain);
  const url = new URL(GDELT_DOC_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'datedesc');
  url.searchParams.set('maxrecords', String(Math.max(1, Math.min(20, options.maxRecords ?? 8))));
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal ?? AbortSignal.timeout(APOLLO_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`gdelt news cross-check ${res.status}: ${text.slice(0, 200)}`);
  }

  const parsed = GdeltDocResponse.parse(await res.json());
  return {
    source: 'gdelt_news',
    query,
    fetchedAt: new Date().toISOString(),
    articles: (parsed.articles ?? [])
      .map((article) => sanitizeApolloPayload(record(article)) as Record<string, unknown>)
      .filter((article) => Object.keys(article).length > 0),
  };
}

function buildCompanyNewsQuery(companyName: string, domain?: string): string {
  const phrase = quoteGdeltPhrase(companyName);
  const normalizedDomain = normalizeDomain(domain ?? null);
  const domainClause = normalizedDomain ? ` OR "${normalizedDomain}"` : '';
  return `(${phrase}${domainClause}) (investment OR funding OR expansion OR hiring OR layoffs OR revenue OR acquisition OR promotion OR CEO OR CFO OR CTO)`;
}

function quoteGdeltPhrase(value: string): string {
  return `"${value.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

export async function callApolloMcpCompanyIntel(
  options: CallApolloMcpOptions,
): Promise<ApolloMcpCompanyIntel> {
  const tools = {
    searchCompanies: 'search_companies',
    getCompany: 'get_company',
    getJobPostings: 'get_job_postings',
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
  let creditPolicy: ApolloCreditPolicy = 'unknown';
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

  // People search and contact leads are not company facts. The flag is ignored.
  void options.includeExecutiveSearch;
  const executives: unknown = null;

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

export async function processCompanyEnrichApolloJob(
  data: ApolloEnrichJobData,
  jobLog: pino.Logger,
): Promise<{ enrichmentId: string } | { skipped: true; reason: string }> {
  const transport = resolveApolloEnrichmentTransport({
    hasDomain: Boolean(data.domain),
  });
  let organization: ApolloOrganization;
  let syncMode: ApolloSyncMode;
  let creditPolicy: ApolloCreditPolicy;
  let rawMcp: Record<string, unknown> | null = null;
  let rawNewsCrossCheck: unknown = null;
  let jobPostings: unknown = null;
  let executives: unknown = null;

  if (transport.kind === 'mcp') {
    const mcpIntel = await callApolloMcpCompanyIntel({
      url: transport.url,
      bearerToken: transport.bearerToken,
      companyName: data.companyName,
      ...(data.domain ? { domain: data.domain } : {}),
      timeoutMs: Number(process.env.APOLLO_MCP_TIMEOUT_MS ?? APOLLO_TIMEOUT_MS),
      includeCreditTools: process.env.APOLLO_MCP_ENABLE_CREDIT_TOOLS === 'true',
      tools: {
        searchCompanies: process.env.APOLLO_MCP_SEARCH_COMPANIES_TOOL ?? 'search_companies',
        getCompany: process.env.APOLLO_MCP_GET_COMPANY_TOOL ?? 'get_company',
        getJobPostings: process.env.APOLLO_MCP_GET_JOB_POSTINGS_TOOL ?? 'get_job_postings',
      },
    });
    organization = mcpIntel.organization;
    syncMode = mcpIntel.syncMode;
    creditPolicy = mcpIntel.creditPolicy;
    rawMcp = mcpIntel.raw;
    jobPostings = mcpIntel.jobPostings;
    executives = mcpIntel.executives;
  } else if (transport.kind === 'none') {
    jobLog.warn(
      {
        companyName: data.companyName,
        hasDomain: Boolean(data.domain),
        reason: transport.reason,
      },
      'Apollo enrichment is a no-op: configure complete Apollo MCP credentials, or APOLLO_API_KEY with a domain',
    );
    return { skipped: true, reason: transport.reason };
  } else {
    const domain = data.domain;
    if (!domain) {
      jobLog.warn(
        { companyName: data.companyName },
        'Apollo REST enrichment skipped because no company domain was provided',
      );
      return { skipped: true, reason: 'Apollo REST fallback requires a company domain' };
    }
    organization = await callApolloEnrich({
      apiKey: transport.apiKey,
      companyName: data.companyName,
      domain,
    });
    syncMode = 'apollo_api_organization_enrich';
    creditPolicy = 'uses_credits';
  }

  if (process.env.APOLLO_NEWS_CROSSCHECK_ENABLED !== 'false') {
    try {
      const newsDomain = data.domain ?? normalizeDomain(organization.primary_domain ?? null);
      rawNewsCrossCheck = await fetchCompanyNewsCrossCheck({
        companyName: data.companyName,
        ...(newsDomain ? { domain: newsDomain } : {}),
      });
    } catch (err) {
      jobLog.warn(
        { err, companyName: data.companyName },
        'Company news cross-check skipped; continuing with Apollo company intelligence',
      );
    }
  }

  const mapped = mapApolloOrganization(organization, {
    syncMode,
    creditPolicy,
    jobPostings,
    executives,
    newsCrossCheck: rawNewsCrossCheck,
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
      confidence: null,
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
    rawNewsCrossCheck: sanitizeApolloPayload(rawNewsCrossCheck),
  };

  // legal_name is NOT NULL. Apollo does not return a legal name, so the
  // required column keeps the organization label. The company serializer
  // still withholds that label until public facts record a legal name.
  const tradeName = organization.name?.trim() || data.companyName;
  const legalName = mapped.legalName?.trim() || tradeName;

  const enrichment = await prisma.companyEnrichment.upsert({
    where: { orgId_normalizedName: { orgId: data.orgId, normalizedName } },
    create: {
      orgId: data.orgId,
      normalizedName,
      legalName,
      tradeName,
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
      confidenceBps: 0,
      sourceAttribution: sourceAttribution as Prisma.InputJsonValue,
      providerMetadata: {
        apollo: apolloMetadata,
        apolloOrganization: sanitizeApolloPayload(organization),
        mappedIndustry: mapped.industry,
        ...(meetingTechStack ? { meetingTechStack } : {}),
      } as unknown as Prisma.InputJsonValue,
      cacheExpiresAt: new Date(Date.now() + APOLLO_COMPANY_CACHE_TTL_MS),
    },
    update: {
      ...(mapped.legalName?.trim() ? { legalName: mapped.legalName.trim() } : {}),
      tradeName,
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
      confidenceBps: 0,
      sourceAttribution: sourceAttribution as Prisma.InputJsonValue,
      providerMetadata: {
        apollo: apolloMetadata,
        apolloOrganization: sanitizeApolloPayload(organization),
        mappedIndustry: mapped.industry,
        ...(meetingTechStack ? { meetingTechStack } : {}),
      } as unknown as Prisma.InputJsonValue,
      cacheExpiresAt: new Date(Date.now() + APOLLO_COMPANY_CACHE_TTL_MS),
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
      return processCompanyEnrichApolloJob(data, jobLog);
    },
    { connection, concurrency: APOLLO_CONCURRENCY },
  );
  workers.push(worker);

  return { queue, worker };
}
