/**
 * company-enrichment.service.ts — CrmCompany entity builders and serializers.
 *
 * WHY a separate module: all logic for turning raw Prisma enrichment rows and
 * opportunity records into typed CrmCompany objects lives here. Isolated from
 * the query layer so it can be unit-tested without a DB connection.
 */
import { type z } from 'zod';

import {
  CompanyStrategicIntel,
  type CrmCompany,
  type CrmLogoSource,
  type SourceAttribution,
} from '@bidstack/shared';

import { COMPANY_DOMAINS, COMPANY_WEBSITES } from './dashboard.defaults.js';
import {
  attribution,
  normalizeName,
  parseAttribution,
  parseTechnicalStack,
  record,
  stringArray,
  stringRecord,
  stringUrl,
} from './dashboard.utils.js';

// ─── Domain / website lookup ──────────────────────────────────────────────────

export function domainFor(name: string) {
  return COMPANY_DOMAINS[name] ?? null;
}

export function websiteFor(name: string) {
  return COMPANY_WEBSITES[name] ?? null;
}

// ─── Logo helpers ─────────────────────────────────────────────────────────────

function asLogoSource(value: string): z.infer<typeof CrmLogoSource> {
  return value === 'official_website' ||
    value === 'logo_dev' ||
    value === 'brandfetch' ||
    value === 'wikimedia' ||
    value === 'favicon' ||
    value === 'manual' ||
    value === 'initials'
    ? value
    : 'manual';
}

export function logoUrlFor(name: string, domain: string | null) {
  if (name === 'Mantu' || domain === 'mantu.com') return 'https://mantu.com/favicon.ico';
  if (!domain) return null;
  return `https://${domain.replace(/^www\./, '')}/favicon.ico`;
}

export function logoFor(name: string, url: string | null, source?: string | null) {
  const resolvedSource =
    name === 'Mantu' && (url === null || url === 'https://mantu.com/favicon.ico')
      ? 'official_website'
      : (source ?? 'favicon');
  return {
    url: url ?? logoUrlFor(name, domainFor(name)),
    source: asLogoSource(resolvedSource),
    cachedAt: new Date().toISOString(),
    attribution: attribution({
      source: resolvedSource,
      label: name === 'Mantu' ? 'Mantu official website logo/fav icon' : 'Company favicon fallback',
      sourceUrl: websiteFor(name),
      confidence: name === 'Mantu' ? 0.99 : 0.62,
    }),
  };
}

// ─── Serializers ──────────────────────────────────────────────────────────────

export function serializeCompany(enrichment: {
  id: string;
  tradeName: string | null;
  legalName: string;
  domain: string | null;
  website: string | null;
  industryCodes: unknown;
  providerMetadata: unknown;
  employeeCount: number | null;
  annualRevenueMicros: bigint | null;
  status: string | null;
  registryIds: unknown;
  formerNames: unknown;
  incorporationDate: Date | null;
  logoUrl: string | null;
  logoSource: string | null;
  confidenceBps: number;
  sourceAttribution: unknown;
  updatedAt: Date;
}): z.infer<typeof CrmCompany> {
  const name = enrichment.tradeName ?? enrichment.legalName;
  const metadata = record(enrichment.providerMetadata);
  const industryCodes = stringArray(enrichment.industryCodes);
  const sourceAttribution = parseAttribution(enrichment.sourceAttribution);
  return {
    id: enrichment.id,
    source: 'verified_data',
    name,
    legalName: enrichment.legalName,
    domain: enrichment.domain,
    website: enrichment.website,
    industry: industryCodes[0] ?? null,
    imageUrl: stringUrl(metadata.companyImageUrl),
    employeeCount: enrichment.employeeCount,
    annualRevenueMicros:
      enrichment.annualRevenueMicros === null ? null : Number(enrichment.annualRevenueMicros),
    status: enrichment.status,
    registryIds: stringRecord(enrichment.registryIds),
    formerNames: stringArray(enrichment.formerNames),
    incorporationDate: enrichment.incorporationDate
      ? enrichment.incorporationDate.toISOString().slice(0, 10)
      : null,
    logo: logoFor(name, enrichment.logoUrl, enrichment.logoSource),
    technicalStack: parseTechnicalStack(metadata.meetingTechStack),
    strategicIntel: parseStrategicIntel({
      metadata,
      sourceAttribution,
      employeeCount: enrichment.employeeCount,
      annualRevenueMicros: enrichment.annualRevenueMicros,
    }),
    confidence: enrichment.confidenceBps / 10_000,
    sourceAttribution,
    updatedAt: enrichment.updatedAt.toISOString(),
  };
}

function parseStrategicIntel({
  metadata,
  sourceAttribution,
  employeeCount,
  annualRevenueMicros,
}: {
  metadata: Record<string, unknown>;
  sourceAttribution: SourceAttribution[];
  employeeCount: number | null;
  annualRevenueMicros: bigint | null;
}): z.infer<typeof CompanyStrategicIntel> | undefined {
  const apollo = record(metadata.apollo);
  if (!Object.keys(apollo).length) return undefined;

  const parsed = CompanyStrategicIntel.safeParse(apollo.strategicIntel);
  if (parsed.success) return parsed.data;

  const lastSyncedAt = stringDate(apollo.lastSyncedAt) ?? latestSourceDate(sourceAttribution);
  const freshness = freshnessFor(lastSyncedAt);
  const syncMode =
    apollo.syncMode === 'apollo_mcp_company_search'
      ? 'apollo_mcp_company_search'
      : apollo.syncMode === 'apollo_mcp_get_company'
        ? 'apollo_mcp_get_company'
        : apollo.syncMode === 'apollo_api_organization_enrich'
          ? 'apollo_api_organization_enrich'
          : 'none';
  const creditPolicy =
    apollo.creditPolicy === 'free_search'
      ? 'free_search'
      : apollo.creditPolicy === 'uses_credits'
        ? 'uses_credits'
        : apollo.creditPolicy === 'mixed'
          ? 'mixed'
          : 'unknown';

  return {
    provider: 'apollo_io',
    lastSyncedAt,
    syncMode,
    creditPolicy,
    freshness,
    employeeTrend: 'unknown',
    employeeCount,
    annualRevenueMicros: annualRevenueMicros === null ? null : Number(annualRevenueMicros),
    intentTopics: [],
    hiringSignals: [],
    leadershipSignals: [],
    revenueSignals: [],
    summary:
      lastSyncedAt === null
        ? 'Apollo has not synced this account yet.'
        : `Apollo sync refreshed ${lastSyncedAt.slice(0, 10)}.`,
    limitations: stringArray(apollo.limitations),
    signals: [],
  };
}

function stringDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function latestSourceDate(sources: SourceAttribution[]): string | null {
  let latest: string | null = null;
  for (const source of sources) {
    if (source.source !== 'apollo_io') continue;
    if (!latest || source.fetchedAt > latest) latest = source.fetchedAt;
  }
  return latest;
}

function freshnessFor(
  lastSyncedAt: string | null,
): z.infer<typeof CompanyStrategicIntel>['freshness'] {
  if (!lastSyncedAt) return 'never';
  const ageMs = Date.now() - new Date(lastSyncedAt).getTime();
  return ageMs > 30 * 24 * 60 * 60 * 1000 ? 'stale' : 'fresh';
}

// ─── Fallback company ─────────────────────────────────────────────────────────

export function fallbackCompany(name: string): z.infer<typeof CrmCompany> {
  const domain = domainFor(name);
  return {
    id: normalizeName(name),
    source: 'bidstack',
    name,
    legalName: name,
    domain,
    website: websiteFor(name),
    industry: name === 'Mantu' ? 'consulting' : null,
    employeeCount: name === 'Mantu' ? 12_000 : null,
    annualRevenueMicros: name === 'Mantu' ? 1_000_000_000_000_000 : null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    imageUrl: null,
    logo: logoFor(
      name,
      logoUrlFor(name, domain),
      name === 'Mantu' ? 'official_website' : 'favicon',
    ),
    confidence: name === 'Mantu' ? 0.99 : 0.5,
    sourceAttribution: [
      attribution({
        source: name === 'Mantu' ? 'official_website' : 'bidstack_seed',
        label: name === 'Mantu' ? 'Mantu official website' : 'BidStack seed profile',
        sourceUrl: websiteFor(name),
        confidence: name === 'Mantu' ? 0.99 : 0.5,
      }),
    ],
    updatedAt: new Date().toISOString(),
  };
}

// ─── Company list builders ────────────────────────────────────────────────────

export function findSelectedCompany(
  companies: Array<z.infer<typeof CrmCompany>>,
  accountId: string | undefined,
) {
  if (!accountId) return null;
  const normalized = normalizeName(accountId);
  return (
    companies.find((company) => company.id === accountId) ??
    companies.find((company) => normalizeName(company.name) === normalized) ??
    null
  );
}

export function buildCompanies(
  opportunities: Array<{
    customer: string;
    industry: string | null;
    logoUrl: string | null;
    updatedAt: Date;
  }>,
  enrichments: Array<{
    id: string;
    tradeName: string | null;
    legalName: string;
    domain: string | null;
    website: string | null;
    industryCodes: unknown;
    providerMetadata: unknown;
    employeeCount: number | null;
    annualRevenueMicros: bigint | null;
    status: string | null;
    registryIds: unknown;
    formerNames: unknown;
    incorporationDate: Date | null;
    logoUrl: string | null;
    logoSource: string | null;
    confidenceBps: number;
    sourceAttribution: unknown;
    updatedAt: Date;
  }>,
) {
  const byName = new Map<string, z.infer<typeof CrmCompany>>();
  for (const enrichment of enrichments) {
    const company = serializeCompany(enrichment);
    byName.set(normalizeName(company.name), company);
  }

  for (const opportunity of opportunities) {
    const normalized = normalizeName(opportunity.customer);
    if (byName.has(normalized)) continue;
    byName.set(normalized, {
      id: normalized,
      source: 'external_crm',
      name: opportunity.customer,
      legalName: opportunity.customer,
      domain: domainFor(opportunity.customer),
      website: websiteFor(opportunity.customer),
      industry: opportunity.industry,
      employeeCount: null,
      annualRevenueMicros: null,
      status: 'active',
      registryIds: {},
      formerNames: [],
      incorporationDate: null,
      imageUrl: null,
      logo: logoFor(opportunity.customer, opportunity.logoUrl),
      confidence: 0.55,
      sourceAttribution: [
        attribution({
          source: 'external_crm',
          label: 'External CRM opportunity/customer record',
          sourceUrl: null,
          confidence: 0.55,
        }),
      ],
      updatedAt: opportunity.updatedAt.toISOString(),
    });
  }

  if (!byName.has('mantu')) byName.set('mantu', fallbackCompany('Mantu'));
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
