/**
 * dashboard.queries.ts — Prisma query wrappers and row serializers for the
 * CRM dashboard pipeline.
 *
 * WHY a separate module: all code that touches PrismaClient lives here.
 * The rest of the dashboard pipeline is pure-transform and can be tested
 * without a DB connection. Queries are always org-scoped (WHERE orgId = ?)
 * per the multi-tenancy contract.
 */
import { type z } from 'zod';

import { OpportunityStage, Prisma, type PrismaClient } from '@bidstack/db';
import type {
  CrmCompany,
  CrmDeal,
  DashboardWidget,
  AccountCockpitSnapshot,
  ProviderHealth,
  QueueHealth,
  ReleaseScore,
} from '@bidstack/shared';

import { buildCompanies } from './company-enrichment.service.js';
import { buildCockpit, microsText, type AccountPerformance } from './dashboard.cockpit.js';
import { defaultReleaseScore } from './dashboard.defaults.js';
import {
  asProviderStatus,
  isCompanyUuid,
  normalizeCountry,
  normalizeName,
  OPPORTUNITY_CUSTOMER_KEY_SQL,
  opportunityCustomerKeySql,
  record,
  recordedDealStage,
} from './dashboard.utils.js';
import {
  applyOpportunityScope,
  countryVariantsForScope,
  type AccessScope,
} from '../../lib/access-scope.js';
import { canReadAccount } from '../../lib/account-access.js';

// ─── Row serializers ──────────────────────────────────────────────────────────

export function serializeDeal(opportunity: {
  id: string;
  customer: string;
  companyId?: string | null;
  name: string;
  stage: string;
  pipelineStage: {
    key: string;
    name: string;
    probability: number | unknown;
    color: string | null;
    isWon: boolean;
    isLost: boolean;
    deletedAt?: Date | null;
  } | null;
  valueMicros: bigint | number | unknown;
  probability: number;
  dueDate: Date | null;
  ownerId: string | null;
  owner: { name: string | null; email: string } | null;
  updatedAt: Date;
  /** Opportunity has no currency column. Callers must not invent one. */
  currencyCode?: string | null;
}): z.infer<typeof CrmDeal> {
  const recorded = opportunity.currencyCode?.trim();
  const liveStage = opportunity.pipelineStage?.deletedAt ? null : opportunity.pipelineStage;
  return {
    id: opportunity.id,
    source: 'external_crm',
    companyId: opportunity.companyId ?? null,
    companyName: opportunity.customer,
    name: opportunity.name,
    stage: recordedDealStage(opportunity),
    stageName: liveStage?.name ?? null,
    amountMicros: microsText(
      typeof opportunity.valueMicros === 'bigint' || typeof opportunity.valueMicros === 'number'
        ? opportunity.valueMicros
        : null,
    ),
    currencyCode: recorded && recorded.length === 3 ? recorded : null,
    // A blank probability is stored as 0. That is not a measured win chance.
    probability: opportunity.probability === 0 ? null : opportunity.probability,
    closeDate: opportunity.dueDate ? opportunity.dueDate.toISOString().slice(0, 10) : null,
    ownerId: opportunity.ownerId,
    ownerName: opportunity.owner?.name ?? opportunity.owner?.email ?? null,
    updatedAt: opportunity.updatedAt.toISOString(),
  };
}

export function serializeWidget(widget: {
  id: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: unknown;
}): z.infer<typeof DashboardWidget> {
  return {
    id: widget.id,
    kind: widget.kind as z.infer<typeof DashboardWidget>['kind'],
    title: widget.title,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    config: record(widget.config),
  };
}

export function serializeProviderHealth(row: {
  provider: string;
  status: string;
  latencyMs: number | null;
  lastCheckedAt: Date;
  message: string | null;
}): z.infer<typeof ProviderHealth> {
  return {
    provider: row.provider,
    status: asProviderStatus(row.status),
    latencyMs: row.latencyMs,
    lastCheckedAt: row.lastCheckedAt.toISOString(),
    message: row.message,
  };
}

export function serializeQueueHealth(row: {
  queueName: string;
  waiting: number;
  active: number;
  failed: number;
  completed: number;
  lastCheckedAt: Date;
}): QueueHealth {
  return {
    queueName: row.queueName,
    waiting: row.waiting,
    active: row.active,
    failed: row.failed,
    completed: row.completed,
    lastCheckedAt: row.lastCheckedAt.toISOString(),
  };
}

export function serializeReleaseScore(row: {
  functional: number;
  code: number;
  design: number;
  infra: number;
  scoredAt: Date;
}): z.infer<typeof ReleaseScore> {
  const total = row.functional + row.code + row.design + row.infra;
  return {
    functional: row.functional,
    code: row.code,
    design: row.design,
    infra: row.infra,
    total,
    passed: total >= 95,
    scoredAt: row.scoredAt.toISOString(),
  };
}

// ─── Lean release-score query ──────────────────────────────────────────────────

/**
 * Fetch ONLY the latest release score for an org.
 *
 * WHY: GET /crm/release-score previously built the full 12-query dashboard
 * snapshot just to read this one org-wide row. The score is scope-independent,
 * so this runs the single findFirst that buildDashboardSnapshot already uses and
 * reuses its exact serializer/fallback — the response shape stays identical.
 */
export async function getReleaseScore(
  orgId: string,
  prisma: PrismaClient,
): Promise<z.infer<typeof ReleaseScore>> {
  const row = await prisma.releaseScore.findFirst({
    where: { orgId },
    select: {
      functional: true,
      code: true,
      design: true,
      infra: true,
      scoredAt: true,
    },
    orderBy: { scoredAt: 'desc' },
  });
  return row ? serializeReleaseScore(row) : defaultReleaseScore();
}

// ─── Lean company query ────────────────────────────────────────────────────────

/** Fetch all CrmCompany objects for an org without loading the full dashboard. */
// Single source of truth for the enrichment columns buildCompanies needs, so
// the list builder and the single-company resolver stay in lockstep.
const ENRICHMENT_SELECT = {
  id: true,
  tradeName: true,
  legalName: true,
  domain: true,
  website: true,
  industryCodes: true,
  providerMetadata: true,
  employeeCount: true,
  annualRevenueMicros: true,
  status: true,
  registryIds: true,
  formerNames: true,
  incorporationDate: true,
  logoUrl: true,
  logoSource: true,
  confidenceBps: true,
  sourceAttribution: true,
  updatedAt: true,
} satisfies Prisma.CompanyEnrichmentSelect;

const OPP_COMPANY_SELECT = {
  customer: true,
  industry: true,
  logoUrl: true,
  updatedAt: true,
} satisfies Prisma.OpportunitySelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Country argument for company search.
 * Blank stays the unfiltered search. A non-empty value that is not ISO-2
 * matches nothing — "France" is not every country. `fr` and `FR` are one code.
 */
export type CompanySearchCountry =
  | { kind: 'any' }
  | { kind: 'none' }
  | { kind: 'code'; code: string };

export function companySearchCountry(country: string | null | undefined): CompanySearchCountry {
  if (country == null) return { kind: 'any' };
  const trimmed = country.trim();
  if (!trimmed) return { kind: 'any' };
  const code = normalizeCountry(trimmed);
  if (!code) return { kind: 'none' };
  return { kind: 'code', code };
}

/** Contradiction so a bad country cannot fall open into the unfiltered search. */
function matchNoRows(orgId: string): { AND: [{ orgId: string }, { NOT: { orgId: string } }] } {
  return { AND: [{ orgId }, { NOT: { orgId } }] };
}

function enrichmentTextWhere(orgId: string, q: string | undefined): Prisma.CompanyEnrichmentWhereInput {
  const query = q?.trim();
  return {
    orgId,
    deletedAt: null,
    ...(query
      ? {
          OR: [
            { tradeName: { contains: query, mode: 'insensitive' as const } },
            { legalName: { contains: query, mode: 'insensitive' as const } },
            { domain: { contains: query, mode: 'insensitive' as const } },
            { website: { contains: query, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

/**
 * Enrichment rows whose name, domain, or website contain the query.
 * No query means the newest rows. Enrichment has no country column: a country
 * code keeps only normalized names already recorded on Company or Opportunity.
 * No such names, or a non-ISO country, matches nothing.
 */
export function enrichmentSearchWhere(
  orgId: string,
  q: string | undefined,
  country?: string | null,
  recordedNormalizedNames?: readonly string[],
): Prisma.CompanyEnrichmentWhereInput {
  const parsed = companySearchCountry(country);
  if (parsed.kind === 'none') return matchNoRows(orgId);
  const text = enrichmentTextWhere(orgId, q);
  if (parsed.kind === 'any') return text;
  const names = [...new Set((recordedNormalizedNames ?? []).map((name) => name.trim()).filter(Boolean))];
  if (names.length === 0) return matchNoRows(orgId);
  return { AND: [text, { normalizedName: { in: names } }] };
}

/**
 * Opportunity rows whose customer contains the query, still inside the caller's scope.
 * A country code also requires Opportunity.country or the linked Company.countryCode.
 */
export function opportunityCustomerSearchWhere(
  orgId: string,
  q: string | undefined,
  scope?: AccessScope,
  country?: string | null,
): Prisma.OpportunityWhereInput {
  const parsed = companySearchCountry(country);
  if (parsed.kind === 'none') {
    const where = matchNoRows(orgId);
    return scope ? applyOpportunityScope(where, scope) : where;
  }
  const query = q?.trim();
  const where: Prisma.OpportunityWhereInput = {
    orgId,
    ...(query ? { customer: { contains: query, mode: 'insensitive' as const } } : {}),
    ...(parsed.kind === 'code'
      ? {
          AND: [
            {
              OR: [
                { country: { equals: parsed.code, mode: 'insensitive' as const } },
                {
                  company: {
                    is: {
                      deletedAt: null,
                      countryCode: { equals: parsed.code, mode: 'insensitive' as const },
                    },
                  },
                },
              ],
            },
          ],
        }
      : {}),
  };
  return scope ? applyOpportunityScope(where, scope) : where;
}

/**
 * buildCompanies injects Mantu whenever that name was not loaded. A country
 * filter keeps only names the search actually recorded, and a non-ISO country
 * keeps nothing. Omitted country returns the list unchanged.
 */
export function companiesMatchingRecordedCountry<T extends { name: string }>(
  country: string | null | undefined,
  companies: readonly T[],
  recordedNames: readonly string[],
): T[] {
  const parsed = companySearchCountry(country);
  if (parsed.kind === 'any') return [...companies];
  if (parsed.kind === 'none') return [];
  const recorded = new Set(recordedNames.map((name) => normalizeName(name)));
  return companies.filter((company) => recorded.has(normalizeName(company.name)));
}

async function visibleCustomerKeys(
  orgId: string,
  prisma: PrismaClient,
  scope: AccessScope,
  names: string[],
): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  const rows = await prisma.opportunity.findMany({
    where: applyOpportunityScope(
      {
        orgId,
        OR: names.map((name) => ({ customer: { equals: name, mode: 'insensitive' as const } })),
      },
      scope,
    ),
    select: { customer: true },
    distinct: ['customer'],
    take: names.length,
  });
  return new Set(rows.map((row) => normalizeName(row.customer)));
}

/** normalizeName(companies.name). Same rules as OPPORTUNITY_CUSTOMER_KEY_SQL. */
const COMPANY_NAME_KEY_SQL =
  "trim(both '-' from regexp_replace(lower(btrim(c.name)), '[^a-z0-9]+', '-', 'g'))";

type OpportunityCompanyRow = {
  customer: string;
  industry: string | null;
  logoUrl: string | null;
  updatedAt: Date;
};

function searchContainsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function asUpdatedAt(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/** Newest row per customer. Each input list is already capped by the search limit. */
function mergeOpportunityCompanies(groups: OpportunityCompanyRow[][]): OpportunityCompanyRow[] {
  const byKey = new Map<string, OpportunityCompanyRow>();
  for (const group of groups) {
    for (const row of group) {
      const key = normalizeName(row.customer);
      const existing = byKey.get(key);
      if (!existing || asUpdatedAt(row.updatedAt) > asUpdatedAt(existing.updatedAt)) byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

/**
 * Opportunities whose customer name matches a Company row in this country,
 * including rows that never set opportunity.companyId. Scope still applies.
 */
async function opportunityCompaniesForRecordedCountry(
  orgId: string,
  prisma: PrismaClient,
  scope: AccessScope | undefined,
  q: string | undefined,
  code: string,
  limit: number,
): Promise<OpportunityCompanyRow[]> {
  const query = q?.trim();
  const customerSql = query
    ? Prisma.sql`AND o.customer ILIKE ${searchContainsPattern(query)} ESCAPE '\\'`
    : Prisma.empty;
  const visibility = opportunityVisibilitySql(scope);
  const customerKey = Prisma.raw(opportunityCustomerKeySql('o.customer'));
  const companyKey = Prisma.raw(COMPANY_NAME_KEY_SQL);
  return prisma.$queryRaw<OpportunityCompanyRow[]>(Prisma.sql`
    SELECT customer, industry, "logoUrl", "updatedAt"
    FROM (
      SELECT DISTINCT ON (${customerKey})
        o.customer AS customer,
        o.industry AS industry,
        o.logo_url AS "logoUrl",
        o.updated_at AS "updatedAt"
      FROM opportunities o
      ${visibility.join}
      WHERE o.org_id = ${orgId}::uuid
        AND o.deleted_at IS NULL
        ${customerSql}
        AND ${customerKey} <> ''
        AND EXISTS (
          SELECT 1
          FROM companies c
          WHERE c.org_id = o.org_id
            AND c.deleted_at IS NULL
            AND upper(btrim(c.country_code)) = ${code}
            AND ${companyKey} <> ''
            AND ${companyKey} = ${customerKey}
        )
        ${visibility.where}
      ORDER BY ${customerKey}, o.updated_at DESC
    ) matched
    ORDER BY "updatedAt" DESC
    LIMIT ${limit}
  `);
}

/**
 * Enrichment normalized names that have a recorded country. The enrichment
 * table itself has no country column, so an enrichment-only row does not match.
 */
async function enrichmentNamesForRecordedCountry(
  orgId: string,
  prisma: PrismaClient,
  scope: AccessScope | undefined,
  q: string | undefined,
  code: string,
  limit: number,
): Promise<string[]> {
  const query = q?.trim();
  const textSql = query
    ? Prisma.sql`AND (
        e.trade_name ILIKE ${searchContainsPattern(query)} ESCAPE '\\'
        OR e.legal_name ILIKE ${searchContainsPattern(query)} ESCAPE '\\'
        OR e.domain ILIKE ${searchContainsPattern(query)} ESCAPE '\\'
        OR e.website ILIKE ${searchContainsPattern(query)} ESCAPE '\\'
      )`
    : Prisma.empty;
  const visibility = opportunityVisibilitySql(scope);
  const customerKey = Prisma.raw(opportunityCustomerKeySql('o.customer'));
  const companyKey = Prisma.raw(COMPANY_NAME_KEY_SQL);
  const rows = await prisma.$queryRaw<Array<{ normalizedName: string }>>(Prisma.sql`
    SELECT e.normalized_name AS "normalizedName"
    FROM company_enrichments e
    WHERE e.org_id = ${orgId}::uuid
      AND e.deleted_at IS NULL
      AND e.normalized_name <> ''
      ${textSql}
      AND (
        EXISTS (
          SELECT 1
          FROM companies c
          WHERE c.org_id = e.org_id
            AND c.deleted_at IS NULL
            AND upper(btrim(c.country_code)) = ${code}
            AND ${companyKey} <> ''
            AND ${companyKey} = e.normalized_name
        )
        OR EXISTS (
          SELECT 1
          FROM opportunities o
          ${visibility.join}
          WHERE o.org_id = e.org_id
            AND o.deleted_at IS NULL
            AND upper(btrim(o.country)) = ${code}
            AND ${customerKey} <> ''
            AND ${customerKey} = e.normalized_name
            ${visibility.where}
        )
      )
    ORDER BY e.updated_at DESC
    LIMIT ${limit}
  `);
  return [...new Set(rows.map((row) => row.normalizedName).filter((name) => name.trim() !== ''))];
}

async function enrichmentsForRecordedCountry(
  orgId: string,
  prisma: PrismaClient,
  scope: AccessScope | undefined,
  q: string | undefined,
  country: string | null | undefined,
  code: string,
  limit: number,
) {
  const names = await enrichmentNamesForRecordedCountry(orgId, prisma, scope, q, code, limit);
  if (names.length === 0) return [];
  return prisma.companyEnrichment.findMany({
    where: enrichmentSearchWhere(orgId, q, country, names),
    select: ENRICHMENT_SELECT,
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
}

async function companiesVisibleToScope(
  orgId: string,
  prisma: PrismaClient,
  scope: AccessScope | undefined,
  opportunities: Array<{ customer: string }>,
  enrichments: Array<{ tradeName: string | null; legalName: string }>,
  companies: Array<z.infer<typeof CrmCompany>>,
  limit: number,
): Promise<Array<z.infer<typeof CrmCompany>>> {
  const restricted = scope && !scope.unrestricted;
  const visibleKeys = restricted
    ? await visibleCustomerKeys(orgId, prisma, scope, [
        ...opportunities.map((opportunity) => opportunity.customer),
        ...enrichments.flatMap((enrichment) =>
          [enrichment.tradeName, enrichment.legalName].filter((name): name is string => Boolean(name)),
        ),
      ])
    : null;
  return companies
    .filter((company) => !visibleKeys || visibleKeys.has(normalizeName(company.name)))
    .slice(0, limit);
}

/**
 * Companies matching a search box. The query runs in the database. A fixed
 * page of recent deals is not the catalog. `country` is ISO-2; anything else
 * that is non-empty matches nothing.
 */
export async function searchCrmCompanies(
  orgId: string,
  prisma: PrismaClient,
  scope: AccessScope | undefined,
  q: string | undefined,
  limit: number,
  country?: string | null,
): Promise<Array<z.infer<typeof CrmCompany>>> {
  const parsed = companySearchCountry(country);
  if (parsed.kind === 'none') return [];

  const [countryOpportunities, linkedCompanyOpportunities, enrichments] = await Promise.all([
    prisma.opportunity.findMany({
      where: opportunityCustomerSearchWhere(
        orgId,
        q,
        scope,
        parsed.kind === 'code' ? country : undefined,
      ),
      select: OPP_COMPANY_SELECT,
      orderBy: { updatedAt: 'desc' },
      distinct: ['customer'],
      take: limit,
    }),
    parsed.kind === 'code'
      ? opportunityCompaniesForRecordedCountry(orgId, prisma, scope, q, parsed.code, limit)
      : Promise.resolve([]),
    parsed.kind === 'code'
      ? enrichmentsForRecordedCountry(orgId, prisma, scope, q, country, parsed.code, limit)
      : prisma.companyEnrichment.findMany({
          where: enrichmentSearchWhere(orgId, q),
          select: ENRICHMENT_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: limit,
        }),
  ]);
  const opportunities =
    parsed.kind === 'code'
      ? mergeOpportunityCompanies([countryOpportunities, linkedCompanyOpportunities])
      : countryOpportunities;
  const built = buildCompanies(opportunities, enrichments);
  const listed = companiesMatchingRecordedCountry(country, built, [
    ...opportunities.map((opportunity) => opportunity.customer),
    ...enrichments.map((enrichment) => enrichment.tradeName ?? enrichment.legalName),
  ]);
  return companiesVisibleToScope(orgId, prisma, scope, opportunities, enrichments, listed, limit);
}

/** Newest page of companies. This is not every company in the org. */
export async function getCompaniesOnly(
  orgId: string,
  prisma: PrismaClient,
  scope?: AccessScope,
): Promise<Array<z.infer<typeof CrmCompany>>> {
  return searchCrmCompanies(orgId, prisma, scope, undefined, 50);
}

export async function companiesForLookup(
  orgId: string,
  prisma: PrismaClient,
  scope: AccessScope | undefined,
  query: { domain?: string | null; name?: string | null; registryNeedles: string[] },
): Promise<Array<z.infer<typeof CrmCompany>>> {
  const name = query.name?.trim();
  const domain = query.domain?.trim();
  const enrichmentOr: Prisma.CompanyEnrichmentWhereInput[] = [];
  if (domain) {
    enrichmentOr.push(
      { domain: { contains: domain, mode: 'insensitive' } },
      { website: { contains: domain, mode: 'insensitive' } },
    );
  }
  if (name) {
    enrichmentOr.push(
      { tradeName: { contains: name, mode: 'insensitive' } },
      { legalName: { contains: name, mode: 'insensitive' } },
    );
  }
  for (const needle of query.registryNeedles) {
    enrichmentOr.push({ registryIds: { string_contains: needle } });
  }
  const [enrichments, opportunities] = await Promise.all([
    enrichmentOr.length
      ? prisma.companyEnrichment.findMany({
          where: { orgId, deletedAt: null, OR: enrichmentOr },
          select: ENRICHMENT_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: 50,
        })
      : Promise.resolve([]),
    name
      ? prisma.opportunity.findMany({
          where: opportunityCustomerSearchWhere(orgId, name, scope),
          select: OPP_COMPANY_SELECT,
          orderBy: { updatedAt: 'desc' },
          distinct: ['customer'],
          take: 20,
        })
      : Promise.resolve([]),
  ]);
  const restricted = scope && !scope.unrestricted;
  const visibleKeys = restricted
    ? await visibleCustomerKeys(orgId, prisma, scope, [
        ...opportunities.map((opportunity) => opportunity.customer),
        ...enrichments.flatMap((enrichment) =>
          [enrichment.tradeName, enrichment.legalName].filter((value): value is string => Boolean(value)),
        ),
      ])
    : null;
  return buildCompanies(opportunities, enrichments).filter(
    (company) => !visibleKeys || visibleKeys.has(normalizeName(company.name)),
  );
}

/**
 * Resolve a SINGLE company for the cockpit without loading the whole org.
 *
 * `companyId` is either an enrichment UUID or a normalized account key (the id
 * buildCompanies assigns opportunity-only companies). The previous cockpit path
 * loaded the org's top 200 opps + 500 enrichments and `.find()`-ed one — which
 * both scaled O(n) per request AND silently 404'd any company outside that
 * window. This resolves enrichment-backed companies by their unique
 * (orgId, id|normalizedName) index, falling back to a bounded distinct-customer
 * scan only for opportunity-only companies.
 */
export async function resolveCockpitCompany(
  orgId: string,
  companyId: string,
  prisma: PrismaClient,
): Promise<z.infer<typeof CrmCompany> | null> {
  const isUuid = UUID_RE.test(companyId);
  const enrichment = await prisma.companyEnrichment.findFirst({
    where: { orgId, deletedAt: null, ...(isUuid ? { id: companyId } : { normalizedName: companyId }) },
    select: ENRICHMENT_SELECT,
  });
  if (enrichment) return buildCompanies([], [enrichment])[0] ?? null;
  if (isUuid) {
    // A UUID that isn't an enrichment may be a Company-table row (manual / key /
    // top account). Resolve it so the cockpit doesn't 404; merge its by-name
    // enrichment for richer fields, then stamp the authoritative id/domain.
    const company = await prisma.company.findFirst({
      where: { orgId, deletedAt: null, id: companyId },
      select: { id: true, name: true, domain: true, logoUrl: true, legalName: true },
    });
    if (!company) return null;
    const byNameEnrichment = await prisma.companyEnrichment.findFirst({
      where: { orgId, deletedAt: null, normalizedName: normalizeName(company.name) },
      select: ENRICHMENT_SELECT,
    });
    const list = byNameEnrichment
      ? buildCompanies([], [byNameEnrichment], [company])
      : buildCompanies(
          [{ customer: company.name, industry: null, logoUrl: company.logoUrl, updatedAt: new Date() }],
          [],
          [company],
        );
    const resolved = list[0];
    if (resolved) {
      resolved.id = company.id;
      if (company.domain) resolved.domain = company.domain;
    }
    return resolved ?? null;
  }
  // Opportunity-only company. The id is normalizeName(customer). Match that key
  // in Postgres so a name outside the newest 1000 customers still resolves.
  const opportunities = await prisma.$queryRaw<
    Array<{ customer: string; industry: string | null; logoUrl: string | null; updatedAt: Date }>
  >(Prisma.sql`
    SELECT customer, industry, logo_url AS "logoUrl", updated_at AS "updatedAt"
    FROM opportunities
    WHERE org_id = ${orgId}::uuid
      AND ${Prisma.raw(OPPORTUNITY_CUSTOMER_KEY_SQL)} = ${companyId}
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  return buildCompanies(opportunities, []).find((c) => c.id === companyId) ?? null;
}

// ─── Customer-key book (slug account id, not a company UUID) ────────────────

/** Joined slug-book expression. Same slug as OPPORTUNITY_CUSTOMER_KEY_SQL. */
export const SLUG_ACCOUNT_CUSTOMER_KEY_SQL = opportunityCustomerKeySql('o.customer');

const WON_OPPORTUNITY_SQL = `
o.stage <> 'closed_lost'
AND NOT EXISTS (
  SELECT 1 FROM pipeline_stages ps
  WHERE ps.id = o.pipeline_stage_id
    AND ps.deleted_at IS NULL
    AND ps.is_lost
)
AND (
  o.stage = 'closed_won'
  OR EXISTS (
    SELECT 1 FROM pipeline_stages ps
    WHERE ps.id = o.pipeline_stage_id
      AND ps.deleted_at IS NULL
      AND ps.is_won
      AND NOT ps.is_lost
  )
)`;

const LOST_OPPORTUNITY_SQL = `
(
  o.stage = 'closed_lost'
  OR EXISTS (
    SELECT 1 FROM pipeline_stages ps
    WHERE ps.id = o.pipeline_stage_id
      AND ps.deleted_at IS NULL
      AND ps.is_lost
  )
)`;

const OPEN_OPPORTUNITY_SQL = `
(
  o.stage NOT IN ('closed_won', 'closed_lost')
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stages ps
    WHERE ps.id = o.pipeline_stage_id
      AND ps.deleted_at IS NULL
      AND (ps.is_won OR ps.is_lost)
  )
)`;

/**
 * Same country / territory / owner predicate as applyOpportunityScope.
 * Empty country lists stay owner-only, matching the Prisma scope.
 */
function opportunityVisibilitySql(scope?: AccessScope): { join: Prisma.Sql; where: Prisma.Sql } {
  if (!scope || scope.unrestricted) return { join: Prisma.empty, where: Prisma.empty };
  const variants = countryVariantsForScope(scope);
  const countrySql =
    variants.length > 0
      ? Prisma.sql`o.country = ANY(ARRAY[${Prisma.join(variants)}]::text[])
        OR t.country_codes && ARRAY[${Prisma.join(variants)}]::text[]
        OR`
      : Prisma.empty;
  return {
    join: Prisma.sql`LEFT JOIN territories t ON t.id = o.territory_id`,
    where: Prisma.sql`AND (
      ${countrySql}
      o.owner_id = ${scope.userId}::uuid
    )`,
  };
}

function accountOpportunityMatchSql(companyId: string): Prisma.Sql | null {
  if (isCompanyUuid(companyId)) return Prisma.sql`o.company_id = ${companyId}::uuid`;
  // normalizeName('---') is ''. That key matches blank customers.
  if (companyId === '') return null;
  return Prisma.sql`${Prisma.raw(SLUG_ACCOUNT_CUSTOMER_KEY_SQL)} = ${companyId}`;
}

const CUSTOMER_KEY_OPPORTUNITY_SELECT = {
  id: true,
  customer: true,
  companyId: true,
  name: true,
  stage: true,
  valueMicros: true,
  probability: true,
  dueDate: true,
  ownerId: true,
  updatedAt: true,
  owner: { select: { name: true, email: true } },
  pipelineStage: {
    select: {
      key: true,
      name: true,
      probability: true,
      color: true,
      isWon: true,
      isLost: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.OpportunitySelect;

const CUSTOMER_KEY_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  createdAt: true,
  dueDate: true,
  accountId: true,
  opportunity: { select: { id: true, customer: true, companyId: true, name: true } },
  assignee: { select: { name: true, email: true } },
} satisfies Prisma.TaskSelect;

/** Opportunities whose customer key is the slug. Does not filter company_id. */
export async function findCustomerKeyOpportunities(
  orgId: string,
  companyId: string,
  prismaClient: PrismaClient,
  scope?: AccessScope,
) {
  const match = accountOpportunityMatchSql(companyId);
  if (!match || isCompanyUuid(companyId)) return [];
  const visibility = opportunityVisibilitySql(scope);
  const rows = await prismaClient.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT o.id
    FROM opportunities o
    ${visibility.join}
    WHERE o.org_id = ${orgId}::uuid
      AND o.deleted_at IS NULL
      AND ${match}
      ${visibility.where}
    ORDER BY o.updated_at DESC
    LIMIT 100
  `);
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  return prismaClient.opportunity.findMany({
    where: { orgId, id: { in: ids }, deletedAt: null },
    select: CUSTOMER_KEY_OPPORTUNITY_SELECT,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Tasks hanging off those opportunities. accountId is a UUID and is not queried. */
export async function findCustomerKeyTasks(
  orgId: string,
  companyId: string,
  prismaClient: PrismaClient,
  scope?: AccessScope,
) {
  const match = accountOpportunityMatchSql(companyId);
  if (!match || isCompanyUuid(companyId)) return [];
  const visibility = opportunityVisibilitySql(scope);
  const rows = await prismaClient.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT task.id
    FROM tasks task
    INNER JOIN opportunities o ON o.id = task.opp_id
    ${visibility.join}
    WHERE task.org_id = ${orgId}::uuid
      AND task.deleted_at IS NULL
      AND o.org_id = ${orgId}::uuid
      AND o.deleted_at IS NULL
      AND ${match}
      ${visibility.where}
    ORDER BY task.created_at DESC
    LIMIT 50
  `);
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  return prismaClient.task.findMany({
    where: { orgId, id: { in: ids }, deletedAt: null },
    select: CUSTOMER_KEY_TASK_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Per-company cockpit query ────────────────────────────────────────────────

/**
 * Lean per-company cockpit builder for GET /crm/companies/:id.
 *
 * WHY: The original handler called buildDashboardSnapshot (12 parallel queries,
 * ~1 000 rows) just to look up one company. This builds the same
 * AccountCockpitSnapshot using 7 targeted queries — it skips widgets,
 * bidOpportunities, insights, providers, queues, and releaseScore entirely,
 * and scopes opportunities, contacts, and tasks to the requested company.
 *
 * Returns null when the company cannot be found (caller should throw 404).
 */
export async function buildCompanyCockpit(
  orgId: string,
  companyId: string,
  prismaClient: PrismaClient,
  scope?: AccessScope,
): Promise<z.infer<typeof AccountCockpitSnapshot> | null> {
  // Step 1: resolve the single company by indexed lookup (was a full-org scan
  // that also capped visibility at the top 200 opps / 500 enrichments).
  const company = await resolveCockpitCompany(orgId, companyId, prismaClient);
  if (!company) return null;
  if (scope) {
    const access = await canReadAccount({
      orgId,
      userId: scope.userId,
      accountId: companyId,
      accountName: company.name,
      scope,
      prismaClient,
    });
    if (!access.allowed) return null;
  }

  const accountIsUuid = isCompanyUuid(company.id);
  const opportunityWhere = accountIsUuid
    ? scope
      ? applyOpportunityScope({ orgId, companyId: company.id, deletedAt: null }, scope)
      : { orgId, companyId: company.id, deletedAt: null }
    : null;
  const taskOpportunityWhere = accountIsUuid
    ? scope
      ? applyOpportunityScope({ companyId: company.id, deletedAt: null }, scope)
      : { companyId: company.id, deletedAt: null }
    : null;

  // Step 2: load company-specific data in parallel (filtered by company).
  // A slug is a customer key. companyId and accountId are UUID columns.
  const [opportunities, contacts, tasks, performance, fieldOverrides] = await Promise.all([
    accountIsUuid && opportunityWhere
      ? prismaClient.opportunity.findMany({
          where: opportunityWhere,
          select: {
            id: true,
            customer: true,
            companyId: true,
            name: true,
            stage: true,
            valueMicros: true,
            probability: true,
            dueDate: true,
            owner: { select: { name: true, email: true } },
            pipelineStage: {
              select: {
                key: true,
                name: true,
                probability: true,
                color: true,
                isWon: true,
                isLost: true,
                deletedAt: true,
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
      : findCustomerKeyOpportunities(orgId, company.id, prismaClient, scope),
    accountIsUuid
      ? prismaClient.contact.findMany({
          where: { orgId, companyId: company.id, deletedAt: null },
          select: {
            id: true,
            customer: true,
            companyId: true,
            name: true,
            role: true,
            email: true,
            phone: true,
            influence: true,
            createdAt: true,
          },
          orderBy: [{ influence: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
          take: 20,
        })
      : Promise.resolve([]),
    accountIsUuid && taskOpportunityWhere
      ? prismaClient.task.findMany({
          where: {
            orgId,
            deletedAt: null,
            OR: [{ accountId: company.id }, { opportunity: taskOpportunityWhere }],
          },
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
            dueDate: true,
            accountId: true,
            opportunity: { select: { id: true, customer: true, companyId: true, name: true } },
            assignee: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : findCustomerKeyTasks(orgId, company.id, prismaClient, scope),
    fetchAccountPerformance(orgId, company.id, prismaClient, scope),
    // WHY: folded into the Promise.all (was a 7th serial query after it) so the
    // cockpit's per-company reads all run in parallel. company.name is already
    // resolved above. Mirrors the shipped pattern in dashboard.service.ts.
    prismaClient.companyFieldOverride.findMany({
      where: { orgId, companyKey: normalizeName(company.name) },
      select: { fieldKey: true, value: true },
      take: 10,
    }),
  ]);

  const accountOpportunityIds = opportunities.map((opportunity) => opportunity.id);
  const contactIds = contacts.map((contact) => contact.id);
  const [riskRows, complianceRows, buyingRoleFacts] = await Promise.all([
    accountOpportunityIds.length === 0
      ? []
      : prismaClient.riskRegisterItem.findMany({
          where: { orgId, deletedAt: null, opportunityId: { in: accountOpportunityIds } },
          select: {
            id: true,
            opportunityId: true,
            title: true,
            severity: true,
            owner: true,
            mitigation: true,
            dueDate: true,
            status: true,
            companyName: true,
          },
          orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
          take: 50,
        }),
    accountOpportunityIds.length === 0
      ? []
      : prismaClient.complianceCheck.findMany({
          where: { orgId, deletedAt: null, opportunityId: { in: accountOpportunityIds } },
          select: {
            id: true,
            opportunityId: true,
            label: true,
            status: true,
            owner: true,
            sourceAttribution: true,
          },
          orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
          take: 50,
        }),
    fetchBuyingRoleFacts(orgId, contactIds, prismaClient),
  ]);

  return buildCockpit({
    company,
    // buildCockpit's type accepts the company list but never reads it; pass the
    // resolved company alone rather than re-loading the whole org.
    companies: [company],
    opportunities,
    contacts,
    tasks,
    risks: riskRows,
    compliance: complianceRows,
    buyingRoleFacts,
    fieldOverrides,
    winLossAvailable: process.env.WIN_LOSS_DATA_AVAILABLE === 'true',
    performance,
  });
}

export function fetchBuyingRoleFacts(orgId: string, contactIds: string[], prismaClient: PrismaClient) {
  if (contactIds.length === 0) return Promise.resolve([]);
  return prismaClient.contactFact.findMany({
    where: { orgId, deletedAt: null, kind: 'buying_role', contactId: { in: contactIds } },
    select: {
      contactId: true,
      status: true,
      linkLabel: true,
      opportunityId: true,
      observedAt: true,
    },
    take: 200,
  });
}

/**
 * Exact win/loss + revenue-by-month for ONE account, computed in Postgres so
 * the numbers are correct regardless of how many opportunities the account has
 * (the cockpit's opportunity list is take-capped for display; aggregates must
 * not be). Sums stay integer micros strings so a large book is not rounded.
 */
const EMPTY_ACCOUNT_PERFORMANCE: AccountPerformance = {
  winLoss: {
    wonCount: 0,
    lostCount: 0,
    wonValueMicros: '0',
    lostValueMicros: '0',
    winRate: null,
  },
  revenueEvolution: [],
  book: { projectCount: 0, openCount: 0, contactCount: 0, taskCount: 0 },
};

export async function fetchAccountPerformance(
  orgId: string,
  companyId: string,
  prismaClient: PrismaClient,
  scope?: AccessScope,
): Promise<AccountPerformance> {
  if (!isCompanyUuid(companyId)) {
    // normalizeName('---') is ''. Matching it would count blank customers.
    if (companyId === '') return EMPTY_ACCOUNT_PERFORMANCE;
    return fetchCustomerKeyPerformance(orgId, companyId, prismaClient, scope);
  }
  const base = { orgId, companyId, deletedAt: null };
  const lostWhere: Prisma.OpportunityWhereInput = {
    ...base,
    OR: [
      { stage: OpportunityStage.closed_lost },
      { pipelineStage: { is: { deletedAt: null, isLost: true } } },
    ],
  };
  const wonWhere: Prisma.OpportunityWhereInput = {
    ...base,
    NOT: {
      OR: [
        { stage: OpportunityStage.closed_lost },
        { pipelineStage: { is: { deletedAt: null, isLost: true } } },
      ],
    },
    OR: [
      { stage: OpportunityStage.closed_won },
      { pipelineStage: { is: { deletedAt: null, isWon: true, isLost: false } } },
    ],
  };
  const openWhere: Prisma.OpportunityWhereInput = {
    ...base,
    stage: { notIn: [OpportunityStage.closed_won, OpportunityStage.closed_lost] },
    NOT: {
      pipelineStage: { is: { deletedAt: null, OR: [{ isWon: true }, { isLost: true }] } },
    },
  };
  const scoped = (where: Prisma.OpportunityWhereInput) =>
    scope ? applyOpportunityScope(where, scope) : where;
  const taskOpportunityWhere = scope
    ? applyOpportunityScope({ companyId, deletedAt: null }, scope)
    : { companyId, deletedAt: null };
  const [won, lost, projects, open, contactCount, taskCount, revenueRows] = await Promise.all([
    prismaClient.opportunity.aggregate({
      where: scoped(wonWhere),
      _sum: { valueMicros: true },
      _count: { _all: true },
    }),
    prismaClient.opportunity.aggregate({
      where: scoped(lostWhere),
      _sum: { valueMicros: true },
      _count: { _all: true },
    }),
    prismaClient.opportunity.count({ where: scoped(base) }),
    prismaClient.opportunity.count({ where: scoped(openWhere) }),
    prismaClient.contact.count({ where: { orgId, companyId, deletedAt: null } }),
    prismaClient.task.count({
      where: {
        orgId,
        deletedAt: null,
        OR: [{ accountId: companyId }, { opportunity: taskOpportunityWhere }],
      },
    }),
    fetchRevenueRows(orgId, companyId, prismaClient, scope),
  ]);

  const wonCount = won._count._all;
  const lostCount = lost._count._all;
  const decided = wonCount + lostCount;

  return {
    winLoss: {
      wonCount,
      lostCount,
      wonValueMicros: microsText(won._sum.valueMicros),
      lostValueMicros: microsText(lost._sum.valueMicros),
      winRate: decided > 0 ? Math.round((wonCount / decided) * 100) : null,
    },
    book: { projectCount: projects, openCount: open, contactCount, taskCount },
    // Raw query returns newest-first (for the LIMIT 12 window); the chart wants
    // oldest-first.
    revenueEvolution: revenueEvolutionFrom(revenueRows),
  };
}

function revenueEvolutionFrom(
  revenueRows: Array<{ period: string; revenue: string | null }>,
): AccountPerformance['revenueEvolution'] {
  return revenueRows
    .map((r) => ({
      period: r.period,
      revenueMicros: microsText(
        typeof r.revenue === 'bigint' ||
          typeof r.revenue === 'number' ||
          typeof r.revenue === 'string'
          ? r.revenue
          : null,
      ),
    }))
    .reverse();
}

function sqlCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

async function fetchCustomerKeyPerformance(
  orgId: string,
  companyId: string,
  prismaClient: PrismaClient,
  scope?: AccessScope,
): Promise<AccountPerformance> {
  if (!accountOpportunityMatchSql(companyId)) return EMPTY_ACCOUNT_PERFORMANCE;
  const [totals, taskRows, revenueRows] = await Promise.all([
    prismaClient.$queryRaw<
      Array<{
        wonCount: number | string | bigint;
        wonValueMicros: string | null;
        lostCount: number | string | bigint;
        lostValueMicros: string | null;
        projectCount: number | string | bigint;
        openCount: number | string | bigint;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE ${Prisma.raw(WON_OPPORTUNITY_SQL)})::int AS "wonCount",
        COALESCE((SUM(o.value_micros) FILTER (WHERE ${Prisma.raw(WON_OPPORTUNITY_SQL)}))::text, '0') AS "wonValueMicros",
        COUNT(*) FILTER (WHERE ${Prisma.raw(LOST_OPPORTUNITY_SQL)})::int AS "lostCount",
        COALESCE((SUM(o.value_micros) FILTER (WHERE ${Prisma.raw(LOST_OPPORTUNITY_SQL)}))::text, '0') AS "lostValueMicros",
        COUNT(*)::int AS "projectCount",
        COUNT(*) FILTER (WHERE ${Prisma.raw(OPEN_OPPORTUNITY_SQL)})::int AS "openCount"
      FROM opportunities o
      ${opportunityVisibilitySql(scope).join}
      WHERE o.org_id = ${orgId}::uuid
        AND o.deleted_at IS NULL
        AND ${accountOpportunityMatchSql(companyId)!}
        ${opportunityVisibilitySql(scope).where}
    `),
    prismaClient.$queryRaw<Array<{ taskCount: number | string | bigint }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "taskCount"
      FROM tasks task
      WHERE task.org_id = ${orgId}::uuid
        AND task.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM opportunities o
          ${opportunityVisibilitySql(scope).join}
          WHERE o.id = task.opp_id
            AND o.org_id = ${orgId}::uuid
            AND o.deleted_at IS NULL
            AND ${accountOpportunityMatchSql(companyId)!}
            ${opportunityVisibilitySql(scope).where}
        )
    `),
    fetchRevenueRows(orgId, companyId, prismaClient, scope),
  ]);
  const row = totals[0];
  const taskRow = taskRows[0];
  if (!row || !taskRow) throw new Error('customer-key book aggregate returned no row');
  const wonCount = sqlCount(row.wonCount);
  const lostCount = sqlCount(row.lostCount);
  const decided = wonCount + lostCount;
  return {
    winLoss: {
      wonCount,
      lostCount,
      wonValueMicros: microsText(row.wonValueMicros),
      lostValueMicros: microsText(row.lostValueMicros),
      winRate: decided > 0 ? Math.round((wonCount / decided) * 100) : null,
    },
    // Contacts link by company UUID only. A matching customer string is not a link.
    book: {
      projectCount: sqlCount(row.projectCount),
      openCount: sqlCount(row.openCount),
      contactCount: 0,
      taskCount: sqlCount(taskRow.taskCount),
    },
    revenueEvolution: revenueEvolutionFrom(revenueRows),
  };
}

async function fetchRevenueRows(
  orgId: string,
  companyId: string,
  prismaClient: PrismaClient,
  scope?: AccessScope,
): Promise<Array<{ period: string; revenue: string | null }>> {
  const match = accountOpportunityMatchSql(companyId);
  if (!match) return [];
  // Won months stay in Postgres. A JS sum of the take-capped page under-reports
  // a book larger than that page. Slug accounts match the customer key; UUID
  // accounts match company_id. Stage rules are WON_OPPORTUNITY_SQL either way.
  const visibility = opportunityVisibilitySql(scope);
  return prismaClient.$queryRaw<Array<{ period: string; revenue: string | null }>>(Prisma.sql`
    SELECT to_char(date_trunc('month', o.due_date), 'YYYY-MM') AS period,
           SUM(o.value_micros)::text AS revenue
    FROM opportunities o
    ${visibility.join}
    WHERE o.org_id = ${orgId}::uuid
      AND ${match}
      AND o.deleted_at IS NULL
      AND o.due_date IS NOT NULL
      AND ${Prisma.raw(WON_OPPORTUNITY_SQL)}
      ${visibility.where}
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 12
  `);
}
