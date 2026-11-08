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
  PublicCompanyFacts,
  microsToSafeNumber,
  type CrmCompany,
  type CrmLogoSource,
  type SourceAttribution,
} from '@bidstack/shared';

import {
  attribution,
  normalizeName,
  parseAttribution,
  parseTechnicalStack,
  mergeTechnicalStack,
  record,
  stringArray,
  stringRecord,
  stringUrl,
} from './dashboard.utils.js';

const COMPANY_STRATEGIC_INTEL_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
type CompanyTechnicalStack = NonNullable<z.infer<typeof CrmCompany>['technicalStack']>;

// ─── Domain / website lookup ──────────────────────────────────────────────────

/** A trade name is not a recorded website. Callers pass a stored domain. */
export function domainFor(_name: string) {
  return null;
}

export function websiteFor(_name: string) {
  return null;
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

export function logoUrlFor(_name: string, domain: string | null) {
  if (!domain) return null;
  return `https://${domain.replace(/^www\./, '')}/favicon.ico`;
}

export function logoFor(_name: string, url: string | null, source?: string | null) {
  const resolvedSource = source ?? 'favicon';
  return {
    url,
    source: asLogoSource(resolvedSource),
    cachedAt: new Date().toISOString(),
    attribution: attribution({
      source: resolvedSource,
      label: resolvedSource === 'favicon' ? 'Company favicon fallback' : 'Stored logo',
      sourceUrl: null,
      confidence: null,
      providerMetadata: { confidenceBasis: 'not_scored' },
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
  const publicLegalName = parsePublicFacts(metadata.publicFacts) ? enrichment.legalName : null;
  return {
    id: enrichment.id,
    source: 'verified_data',
    name,
    // The column is required, so a meeting import stores the typed name there.
    // That string is not a legal name until public facts or the account record say so.
    legalName: publicLegalName,
    legalNameSource: publicLegalName ? 'public' : null,
    domain: enrichment.domain,
    website: enrichment.website,
    industry: industryCodes[0] ?? null,
    publicFacts: parsePublicFacts(metadata.publicFacts),
    imageUrl: stringUrl(metadata.companyImageUrl),
    employeeCount: enrichment.employeeCount,
    annualRevenueMicros: microsToSafeNumber(enrichment.annualRevenueMicros),
    annualRevenueMicrosText:
      enrichment.annualRevenueMicros === null ? null : enrichment.annualRevenueMicros.toString(),
    status: enrichment.status,
    registryIds: stringRecord(enrichment.registryIds),
    formerNames: stringArray(enrichment.formerNames),
    incorporationDate: enrichment.incorporationDate
      ? enrichment.incorporationDate.toISOString().slice(0, 10)
      : null,
    logo: logoFor(name, enrichment.logoUrl, enrichment.logoSource),
    technicalStack: buildProviderTechnicalStack(metadata),
    strategicIntel: parseStrategicIntel({
      metadata,
      sourceAttribution,
      employeeCount: enrichment.employeeCount,
      annualRevenueMicros: enrichment.annualRevenueMicros,
    }),
    confidence: enrichment.confidenceBps > 0 ? enrichment.confidenceBps / 10_000 : null,
    sourceAttribution,
    updatedAt: enrichment.updatedAt.toISOString(),
  };
}

function parsePublicFacts(value: unknown): z.infer<typeof PublicCompanyFacts> | null {
  const parsed = PublicCompanyFacts.safeParse(value);
  return parsed.success ? parsed.data : null;
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
  if (parsed.success) {
    return { ...parsed.data, freshness: freshnessFor(parsed.data.lastSyncedAt) };
  }

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
    annualRevenueMicros: microsToSafeNumber(annualRevenueMicros),
    intentTopics: [],
    hiringSignals: [],
    leadershipSignals: [],
    revenueSignals: [],
    newsSignals: [],
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
  return ageMs > COMPANY_STRATEGIC_INTEL_STALE_AFTER_MS ? 'stale' : 'fresh';
}

function buildProviderTechnicalStack(metadata: Record<string, unknown>): CompanyTechnicalStack {
  return dedupeTechnicalStack(
    mergeTechnicalStack(
      mergeTechnicalStack(
        parseTechnicalStack(metadata.meetingTechStack),
        seamlessTechnicalStack(metadata),
      ),
      techStackMcpTechnicalStack(metadata),
    ),
  );
}

function seamlessTechnicalStack(metadata: Record<string, unknown>): CompanyTechnicalStack {
  const openCompanyProfile = record(metadata.openCompanyProfile);
  const seamlessProfiles = [record(openCompanyProfile.seamless), record(metadata.seamless)];
  const technologies = [
    ...new Set(seamlessProfiles.flatMap((profile) => stringArray(profile.technologies))),
  ]
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 24);

  if (technologies.length === 0) return [];
  return [
    {
      label: 'Seamless technologies',
      items: technologies.map((name) => ({
        name,
        source: 'enrichment:seamless',
        confidence: null,
      })),
    },
  ];
}

function techStackMcpTechnicalStack(metadata: Record<string, unknown>): CompanyTechnicalStack {
  const providerProfiles = Array.isArray(metadata.techStackMcps)
    ? metadata.techStackMcps.map(record)
    : [];
  const profiles = providerProfiles.length > 0 ? providerProfiles : [record(metadata.techStackMcp)];
  return profiles.flatMap((rawProfile) => {
    const technologies = stringArray(rawProfile.technologies)
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 30);
    if (technologies.length === 0) return [];
    const provider = stringArray([rawProfile.provider])[0] ?? 'Tech Intel MCP';
    const source = `enrichment:tech_stack_mcp:${slugProviderSource(provider)}`;
    return [
      {
        label: `${provider} technologies`,
        items: technologies.map((name) => ({
          name,
          source,
          confidence: null,
        })),
      },
    ];
  });
}

function slugProviderSource(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'source'
  );
}

function dedupeTechnicalStack(stack: CompanyTechnicalStack): CompanyTechnicalStack {
  const chosen = new Map<
    string,
    { label: string; item: CompanyTechnicalStack[number]['items'][number] }
  >();

  for (const category of stack) {
    for (const item of category.items) {
      const key = item.name.trim().toLowerCase();
      if (!key) continue;
      const existing = chosen.get(key);
      const existingScore = existing?.item.confidence ?? -1;
      const nextScore = item.confidence ?? -1;
      if (!existing || nextScore > existingScore) {
        chosen.set(key, { label: category.label, item });
      }
    }
  }

  const byCategory = new Map<string, CompanyTechnicalStack[number]>();
  for (const { label, item } of chosen.values()) {
    const category = byCategory.get(label) ?? { label, items: [] };
    category.items.push(item);
    byCategory.set(label, category);
  }
  return [...byCategory.values()];
}

// ─── Fallback company ─────────────────────────────────────────────────────────

export function fallbackCompany(name: string): z.infer<typeof CrmCompany> {
  const domain = domainFor(name);
  return {
    id: normalizeName(name),
    source: 'bidstack',
    name,
    legalName: null,
    domain,
    website: websiteFor(name),
    industry: null,
    employeeCount: null,
    annualRevenueMicros: null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    imageUrl: null,
    logo: logoFor(name, null, 'favicon'),
    confidence: null,
    sourceAttribution: [
      attribution({
        source: 'bidstack_seed',
        label: 'Placeholder account. No measured profile is attached.',
        sourceUrl: null,
        confidence: null,
        providerMetadata: { confidenceBasis: 'not_scored' },
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
  companyRows: Array<{
    id: string;
    name: string;
    domain: string | null;
    logoUrl: string | null;
    legalName?: string | null;
  }> = [],
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
      legalName: null,
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
      confidence: null,
      sourceAttribution: [
        attribution({
          source: 'external_crm',
          label: 'Customer name copied from an opportunity. Not a scored source.',
          sourceUrl: null,
          confidence: null,
          providerMetadata: { confidenceBasis: 'not_scored' },
        }),
      ],
      updatedAt: opportunity.updatedAt.toISOString(),
    });
  }

  // Authoritative Company-table overrides: stamp the real id (so the cockpit
  // resolves by it via findSelectedCompany) and let manual domain/logo win over
  // guessed values. Override-only — we do not surface empty Company rows that
  // have no opportunity/enrichment footprint.
  for (const row of companyRows) {
    const existing = byName.get(normalizeName(row.name));
    if (!existing) continue;
    existing.id = row.id;
    if (row.domain) existing.domain = row.domain;
    const savedLegalName = row.legalName?.trim();
    if (savedLegalName && savedLegalName !== row.name.trim()) {
      existing.legalName = savedLegalName;
      existing.legalNameSource = 'account';
    }
    const logoDomain = row.domain ?? existing.domain;
    if (row.logoUrl) {
      existing.logo = logoFor(existing.name, row.logoUrl, 'official_website');
    } else if (!existing.logo?.url && logoDomain) {
      existing.logo = logoFor(existing.name, logoUrlFor(existing.name, logoDomain), 'favicon');
    }
  }

  if (!byName.has('mantu')) byName.set('mantu', fallbackCompany('Mantu'));
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
