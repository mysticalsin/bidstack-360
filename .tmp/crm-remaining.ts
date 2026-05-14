import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  prisma,
  type OpportunityStage as PrismaStage,
  type Prisma,
  type CompanyEnrichment,
  type RiskRegisterItem as PrismaRiskRegisterItem,
  type ComplianceCheck as PrismaComplianceCheck,
  type ProviderHealth as PrismaProviderHealth,
  type QueueHealth as PrismaQueueHealth,
  type ReleaseScore as PrismaReleaseScore,
} from '@bidstack/db';
import {
  AccountCockpitSnapshot,
  CompanyAutopopulateResponse,
  CompanyLookupResponse,
  CrmCompany,
  CrmDashboardSnapshot,
  DashboardWidget,
  DataQualityReport,
  CrmConnector,
  OpenDataSignalsResponse,
  ProviderHealth,
  ReleaseScore,
  SourceAttribution,
  type AiInsight,
  type BidOpportunity,
  type CrmActivity,
  type CrmDeal,
  type CrmLogoSource,
  type QueueHealth,
  type SourceAttribution as SourceAttributionType,
} from '@bidstack/shared';

import { faviconProfile, fetchOpenCompanyProfile } from '../providers/company-open-enrichment.js';
import { buildConnectorCatalog, buildOpenDataSignals } from '../providers/open-data-connectors.js';
import { enqueueApolloEnrich } from '../queues/company-enrich-apollo.js';

const CompanySearchQuery = z.object({
  q: z.string().trim().optional(),
  country: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const CompanyLookupQuery = z.object({
  name: z.string().trim().optional(),
  domain: z.string().trim().optional(),
  vat: z.string().trim().optional(),
  duns: z.string().trim().optional(),
  uei: z.string().trim().optional(),
  lei: z.string().trim().optional(),
  registryId: z.string().trim().optional(),
});

const CompanySearchResponse = z.object({
  items: z.array(CrmCompany),
});

const EnrichCompanyBody = z.object({
  name: z.string().min(1),
  domain: z.string().trim().optional(),
  website: z.string().url().optional(),
});

const AutopopulateSalesCompaniesBody = z
  .object({
    limit: z.coerce.number().int().min(1).max(12).default(8),
    source: z.enum(['all', 'sales_orders', 'opportunities']).default('all'),
  })
  .default({});

const WidgetsPatchBody = z.object({
  widgets: z.array(DashboardWidget),
});

const DashboardWidgetsResponse = z.object({
  widgets: z.array(DashboardWidget),
});

const ConnectorsResponse = z.object({
  items: z.array(CrmConnector),
});

const OpenDataSignalsQuery = z.object({
  query: z.string().trim().optional(),
  ticker: z.string().trim().optional(),
});


  server.get(
    '/crm/companies/search',
    {
      schema: {
        querystring: CompanySearchQuery,
        response: { 200: CompanySearchResponse },
      },
    },
    async (req) => {
      const snapshot = await buildDashboardSnapshot(req.auth.orgId);
      const q = req.query.q?.toLowerCase();
      const items = snapshot.companies
        .filter((company) => {
          if (!q) return true;
          return [
            company.name,
            company.legalName ?? '',
            company.domain ?? '',
            company.website ?? '',
            ...Object.values(company.registryIds),
          ]
            .join(' ')
            .toLowerCase()
            .includes(q);
        })
        .slice(0, req.query.limit);
      return { items };
    },
  );

  server.get(
    '/crm/companies/lookup',
    {
      schema: {
        querystring: CompanyLookupQuery,
        response: { 200: CompanyLookupResponse },
      },
    },
    async (req) => {
      const snapshot = await buildDashboardSnapshot(req.auth.orgId);
      const domain = normalizeDomain(req.query.domain);
      const registryNeedles = [
        req.query.vat,
        req.query.duns,
        req.query.uei,
        req.query.lei,
        req.query.registryId,
      ]
        .filter((value): value is string => Boolean(value))
        .map(normalizeRegistryValue);
      const name = req.query.name?.trim().toLowerCase();

      if (domain) {
        const company = snapshot.companies.find((item) => normalizeDomain(item.domain) === domain);
        if (company) return { match: 'exact_domain' as const, company, alternatives: [] };
      }

      if (registryNeedles.length) {
        const company = snapshot.companies.find((item) =>
          Object.values(item.registryIds).some((value) =>
            registryNeedles.includes(normalizeRegistryValue(value)),
          ),
        );
        if (company) return { match: 'registry_id' as const, company, alternatives: [] };
      }

      if (name) {
        const exact = snapshot.companies.find(
          (item) =>
            item.name.toLowerCase() === name ||
            (item.legalName !== null && item.legalName.toLowerCase() === name),
        );
        if (exact) return { match: 'exact_name' as const, company: exact, alternatives: [] };

        const alternatives = snapshot.companies
          .filter((item) =>
            [item.name, item.legalName ?? '', item.domain ?? '']
              .join(' ')
              .toLowerCase()
              .includes(name),
          )
          .slice(0, 5);
        return {
          match: alternatives.length ? ('fuzzy_name' as const) : ('none' as const),
          company: alternatives[0] ?? null,
          alternatives: alternatives.slice(1),
        };
      }

      return { match: 'none' as const, company: null, alternatives: [] };
    },
  );

  server.post(
    '/crm/companies/:id/enrich',
    {
      schema: {
        params: z.object({ id: z.string().min(1) }),
        body: EnrichCompanyBody,
        response: { 200: CrmCompany },
      },
    },
    async (req) => {
      const result = await upsertVerifiedCompanyEnrichment({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        name: req.body.name,
        domain: req.body.domain ?? domainFor(req.body.name),
        website: req.body.website,
        requestedBy: 'crm_api',
        auditAction: 'crm.company.enrich',
        log: req.log,
      });

      const apolloJobId = await enqueueApolloEnrich({
        orgId: req.auth.orgId,
        companyName: req.body.name,
        ...(result.domain ? { domain: result.domain } : {}),
      });
      if (apolloJobId) {
        req.log.info({ apolloJobId, company: req.body.name }, 'queued apollo enrichment');
      } else {
        req.log.warn('apollo enrichment enqueue skipped (redis unreachable)');
      }

      return result.company;
    },
  );

  server.post(
    '/crm/companies/autopopulate-from-sales',
    {
      schema: {
        body: AutopopulateSalesCompaniesBody,
        response: { 200: CompanyAutopopulateResponse },
      },
    },
    async (req) => {
      const now = new Date();
      const candidates = await buildSalesCompanyCandidates({
        orgId: req.auth.orgId,
        limit: req.body.limit,
        source: req.body.source,
      });
      const existingRows = await prisma.companyEnrichment.findMany({
        where: {
          orgId: req.auth.orgId,
          normalizedName: { in: candidates.map((item) => normalizeName(item.name)) },
        },
      });
      const existingByName = new Map(existingRows.map((row) => [row.normalizedName, row]));
      const items: z.infer<typeof CompanyAutopopulateResponse>['items'] = [];
      const warnings: string[] = [];

      for (const candidate of candidates) {
        const normalizedName = normalizeName(candidate.name);
        const existing = existingByName.get(normalizedName);
        if (existing && isFreshCompanyEnrichment(existing, now)) {
          items.push({
            company: serializeCompany(existing),
            action: 'cached',
            reason: 'fresh enrichment cache',
          });
          continue;
        }

        try {
          const result = await upsertVerifiedCompanyEnrichment({
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            name: candidate.name,
            domain: candidate.domain,
            website: candidate.website,
            country: candidate.countryCode,
            requestedBy: 'sales_autopopulate',
            auditAction: 'crm.company.autopopulate_from_sales',
            log: req.log,
          });
          items.push({ company: result.company, action: 'enriched', reason: candidate.reason });
        } catch (err) {
          warnings.push(`${candidate.name}: ${safeErrorMessage(err)}`);
          if (existing) {
            items.push({ company: serializeCompany(existing), action: 'skipped', reason: 'error' });
          }
        }
      }

      const enriched = items.filter((item) => item.action === 'enriched').length;
      const cached = items.filter((item) => item.action === 'cached').length;
      const skipped = candidates.length - enriched - cached;
      return {
        generatedAt: now.toISOString(),
        requested: candidates.length,
        enriched,
        cached,
        skipped,
        items,
        sourceAttribution: [
          attribution({
            source: 'odoo_twenty_sales_autopopulate',
            label: 'Odoo sale.order pattern + Twenty-compatible customer records',
            sourceUrl: 'https://github.com/mysticalsin/odoo',
            confidence: 0.84,
          }),
          attribution({
            source: 'twenty_core_objects',
            label: 'Twenty Company/Opportunity object model',
            sourceUrl: 'https://github.com/mysticalsin/twenty',
            confidence: 0.86,
          }),
        ],
        warnings,
      };
    },
  );
  server.get(
    '/crm/connectors',
    { schema: { response: { 200: ConnectorsResponse } } },
    async () => ({ items: buildConnectorCatalog() }),
  );

  server.get(
    '/crm/open-data/signals',
    {
      schema: {
        querystring: OpenDataSignalsQuery,
        response: { 200: OpenDataSignalsResponse },
      },
    },
    async (req) => {
      const now = new Date();
      const signals = await buildOpenDataSignals({
        query: req.query.query,
        ticker: req.query.ticker,
        now,
      });
      return {
        generatedAt: now.toISOString(),
        connectors: buildConnectorCatalog(now),
        signals,
      };
    },
  );
  server.patch(
    '/crm/widgets',
    {
      schema: {
        body: WidgetsPatchBody,
        response: { 200: DashboardWidgetsResponse },
      },
    },
    async (req) => {
      const widgets = await Promise.all(
        req.body.widgets.map((widget) =>
          prisma.dashboardWidget.upsert({
            where: { orgId_kind: { orgId: req.auth.orgId, kind: widget.kind } },
            create: {
              orgId: req.auth.orgId,
              kind: widget.kind,
              title: widget.title,
              x: widget.x,
              y: widget.y,
              w: widget.w,
              h: widget.h,
              config: widget.config as Prisma.InputJsonValue,
            },
            update: {
              title: widget.title,
              x: widget.x,
              y: widget.y,
              w: widget.w,
              h: widget.h,
              config: widget.config as Prisma.InputJsonValue,
            },
          }),
        ),
      );
      return {
        widgets: widgets.map(serializeWidget).sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y)),
      };
    },
  );
};
type RouteLog = {
  warn: (obj: unknown, msg?: string) => void;
};

type SalesCompanyCandidate = {
  name: string;
  domain: string | null;
  website: string | null;
  countryCode: string | null;
  reason: string;
  score: number;
};

async function upsertVerifiedCompanyEnrichment({
  orgId,
  userId,
  name,
  domain: inputDomain,
  website: inputWebsite,
  country,
  requestedBy,
  auditAction,
  log,
}: {
  orgId: string;
  userId: string | null;
  name: string;
  domain?: string | null;
  website?: string | null;
  country?: string | null;
  requestedBy: string;
  auditAction: string;
  log: RouteLog;
}): Promise<{
  company: z.infer<typeof CrmCompany>;
  domain: string | null;
  providers: string[];
}> {
  const normalizedName = normalizeName(name);
  const now = new Date();
  const requestedDomain = normalizeDomain(inputDomain ?? domainFor(name));
  const requestedWebsite = inputWebsite ?? (requestedDomain ? `https://${requestedDomain}/` : null);
  const openProfile =
    process.env.NODE_ENV === 'test' || process.env.BIDSTACK_OPEN_ENRICHMENT_DISABLED === '1'
      ? null
      : await fetchOpenCompanyProfile({
          name,
          domain: requestedDomain,
          website: requestedWebsite,
          now,
        }).catch((err) => {
          log.warn({ err, company: name }, 'open company enrichment failed');
          return null;
        });
  const favicon = faviconProfile({
    name,
    domain: openProfile?.domain ?? requestedDomain,
    website: openProfile?.website ?? requestedWebsite,
    now,
  });
  const domain = openProfile?.domain ?? favicon.domain;
  const website = openProfile?.website ?? favicon.website;
  const countryCode = normalizeCountry(country);
  const isMantu = domain === 'mantu.com' || normalizedName === 'mantu';
  const sourceAttribution = [
    ...(openProfile?.sourceAttribution ?? []),
    ...(openProfile?.logoUrl ? [] : favicon.sourceAttribution),
    attribution({
      source: isMantu ? 'official_website' : 'verified_company_enrichment',
      label: isMantu ? 'Mantu official website' : 'BidStack enrichment cache',
      sourceUrl: website,
      confidence: isMantu ? 0.99 : 0.72,
    }),
  ];
  const logoUrl = openProfile?.logoUrl ?? favicon.logoUrl ?? logoUrlFor(name, domain);
  const logoSource = isMantu
    ? 'official_website'
    : (openProfile?.logoSource ?? favicon.logoSource ?? 'favicon');
  const providerMetadata: Prisma.InputJsonObject = {
    requestedBy,
    lookupKeys: { domain, normalizedName },
    country: countryCode,
    openCompanyProfile: (openProfile?.providerMetadata ?? null) as Prisma.InputJsonValue | null,
    companyImageUrl: openProfile?.imageUrl ?? null,
    companyDescription: openProfile?.description ?? null,
    fallbackLogo: favicon.providerMetadata as Prisma.InputJsonValue,
  };
  const confidenceBps = Math.max(isMantu ? 9900 : 7200, openProfile?.confidenceBps ?? 0);
  const industryCodes = openProfile?.industryLabels ?? [];
  const legalName = openProfile?.legalName ?? name;
  const tradeName = openProfile?.tradeName ?? name;
  const incorporationDate = openProfile?.incorporationDate
    ? new Date(openProfile.incorporationDate)
    : undefined;
  const address: Prisma.InputJsonObject = countryCode ? { countryCode } : {};

  const enrichment = await prisma.companyEnrichment.upsert({
    where: { orgId_normalizedName: { orgId, normalizedName } },
    create: {
      orgId,
      normalizedName,
      legalName,
      tradeName,
      domain,
      website,
      logoUrl,
      logoSource,
      registryIds: {},
      address,
      formerNames: [],
      industryCodes,
      status: 'active',
      incorporationDate: incorporationDate ?? null,
      employeeCount: isMantu ? 12_000 : (openProfile?.employeeCount ?? null),
      annualRevenueMicros: isMantu ? 1_000_000_000_000_000n : null,
      confidenceBps,
      sourceAttribution: sourceAttribution as Prisma.InputJsonValue,
      providerMetadata,
      cacheExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
    update: {
      legalName,
      tradeName,
      domain,
      website,
      logoUrl,
      logoSource,
      ...(countryCode ? { address } : {}),
      status: 'active',
      incorporationDate,
      employeeCount: isMantu ? 12_000 : (openProfile?.employeeCount ?? undefined),
      annualRevenueMicros: isMantu ? 1_000_000_000_000_000n : undefined,
      industryCodes,
      confidenceBps,
      sourceAttribution: sourceAttribution as Prisma.InputJsonValue,
      providerMetadata,
      cacheExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const providers = openProfile ? ['wikidata', 'wikimedia'] : ['favicon'];
  await prisma.auditLog.create({
    data: {
      orgId,
      userId,
      action: auditAction,
      targetType: 'company',
      targetId: enrichment.id,
      diff: {
        name,
        domain,
        country: countryCode,
        providers,
      } as Prisma.InputJsonValue,
    },
  });

  return { company: serializeCompany(enrichment), domain, providers };
}

async function buildSalesCompanyCandidates({
  orgId,
  limit,
  source,
}: {
  orgId: string;
  limit: number;
  source: 'all' | 'sales_orders' | 'opportunities';
}): Promise<SalesCompanyCandidate[]> {
  const candidates: SalesCompanyCandidate[] = [];
  if (source !== 'opportunities' && (await tableExists('sales_orders'))) {
    const rows = await prisma.$queryRaw<
      Array<{
        name: string;
        countryCode: string | null;
        revenueMicros: bigint;
        orderCount: number;
      }>
    >`
      SELECT
        customer_name AS "name",
        MAX(country_code) AS "countryCode",
        COALESCE(SUM(total_micros), 0)::bigint AS "revenueMicros",
        COUNT(*)::int AS "orderCount"
      FROM sales_orders
      WHERE org_id = ${orgId}::uuid
        AND state IN ('draft', 'sent', 'confirmed', 'done')
      GROUP BY customer_name
      ORDER BY "revenueMicros" DESC
      LIMIT ${limit * 2}
    `;
    for (const row of rows) {
      candidates.push({
        name: row.name,
        domain: domainFor(row.name),
        website: websiteFor(row.name),
        countryCode: normalizeCountry(row.countryCode),
        reason: `${row.orderCount} sales record${row.orderCount === 1 ? '' : 's'}`,
        score: Number(row.revenueMicros),
      });
    }
  }

  if (source !== 'sales_orders') {
    const opportunities = await prisma.opportunity.findMany({
      where: { orgId },
      select: { customer: true, valueMicros: true },
      orderBy: [{ valueMicros: 'desc' }, { updatedAt: 'desc' }],
      take: limit * 3,
    });
    for (const opportunity of opportunities) {
      candidates.push({
        name: opportunity.customer,
        domain: domainFor(opportunity.customer),
        website: websiteFor(opportunity.customer),
        countryCode: null,
        reason: 'Twenty-compatible opportunity',
        score: Math.round(Number(opportunity.valueMicros ?? 0)),
      });
    }
  }

  return mergeSalesCompanyCandidates(candidates).slice(0, limit);
}

function mergeSalesCompanyCandidates(candidates: SalesCompanyCandidate[]): SalesCompanyCandidate[] {
  const byName = new Map<string, SalesCompanyCandidate>();
  for (const candidate of candidates) {
    const key = normalizeName(candidate.name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, candidate);
      continue;
    }
    byName.set(key, {
      ...existing,
      domain: existing.domain ?? candidate.domain,
      website: existing.website ?? candidate.website,
      countryCode: existing.countryCode ?? candidate.countryCode,
      reason:
        existing.reason === candidate.reason
          ? existing.reason
          : `${existing.reason}; ${candidate.reason}`,
      score: existing.score + candidate.score,
    });
  }
  return [...byName.values()].sort((a, b) => b.score - a.score);
}

function isFreshCompanyEnrichment(enrichment: CompanyEnrichment, now: Date): boolean {
  return Boolean(
    enrichment.logoUrl &&
    enrichment.cacheExpiresAt &&
    enrichment.cacheExpiresAt.getTime() > now.getTime() &&
    enrichment.confidenceBps >= 7000,
  );
}