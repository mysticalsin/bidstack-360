/**
 * company-enrichment.service.ts — CrmCompany entity builders and serializers.
 *
 * WHY a separate module: all logic for turning raw Prisma enrichment rows and
 * opportunity records into typed CrmCompany objects lives here. Isolated from
 * the query layer so it can be unit-tested without a DB connection.
 */
import { type z } from 'zod';

import type { CrmCompany, CrmLogoSource } from '@bidstack/shared';

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
    confidence: enrichment.confidenceBps / 10_000,
    sourceAttribution: parseAttribution(enrichment.sourceAttribution),
    updatedAt: enrichment.updatedAt.toISOString(),
  };
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
