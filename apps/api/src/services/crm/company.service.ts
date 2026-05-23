import { type z } from 'zod';
import type { PrismaClient, CompanyEnrichment } from '@bidstack/db';
import { type CompanyAutopopulateResponse } from '@bidstack/shared';

import {
  normalizeName,
  normalizeCountry,
  domainFor,
  websiteFor,
  serializeCompany,
  safeErrorMessage,
  attribution,
} from './dashboard.service.js';
import { upsertVerifiedCompanyEnrichment, type RouteLog } from './enrichment.service.js';

type SalesCompanyCandidate = {
  name: string;
  domain: string | null;
  website: string | null;
  countryCode: string | null;
  reason: string;
  score: number;
};

export async function buildSalesCompanyCandidates({
  orgId,
  limit,
  source,
  prisma,
}: {
  orgId: string;
  limit: number;
  source: 'all' | 'sales_orders' | 'opportunities';
  prisma: PrismaClient;
}): Promise<SalesCompanyCandidate[]> {
  const candidates: SalesCompanyCandidate[] = [];
  if (source !== 'opportunities' && (await tableExists(prisma, 'sales_orders'))) {
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
        reason: 'External CRM opportunity',
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

export function isFreshCompanyEnrichment(enrichment: CompanyEnrichment, now: Date): boolean {
  return Boolean(
    enrichment.logoUrl &&
    enrichment.cacheExpiresAt &&
    enrichment.cacheExpiresAt.getTime() > now.getTime() &&
    enrichment.confidenceBps >= 7000,
  );
}

async function tableExists(prisma: PrismaClient, tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ tableName: string | null }>>`
    SELECT to_regclass(${`public.${tableName}`})::text AS "tableName"
  `;
  return Boolean(rows[0]?.tableName);
}

export async function autopopulateCompanies({
  orgId,
  userId,
  limit,
  source,
  prisma,
  log,
}: {
  orgId: string;
  userId: string | null;
  limit: number;
  source: 'all' | 'sales_orders' | 'opportunities';
  prisma: PrismaClient;
  log: RouteLog;
}): Promise<
  z.infer<typeof CompanyAutopopulateResponse> & {
    generatedAt: string;
    requested: number;
    enriched: number;
    cached: number;
    skipped: number;
    warnings: string[];
  }
> {
  const now = new Date();
  const candidates = await buildSalesCompanyCandidates({ orgId, limit, source, prisma });
  const existingRows = await prisma.companyEnrichment.findMany({
    where: {
      orgId,
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
        reason: 'fresh verified data cache',
      });
      continue;
    }

    try {
      const result = await upsertVerifiedCompanyEnrichment({
        orgId,
        userId,
        name: candidate.name,
        domain: candidate.domain,
        website: candidate.website,
        country: candidate.countryCode,
        requestedBy: 'sales_autopopulate',
        auditAction: 'crm.company.autopopulate_from_sales',
        log,
        prisma,
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
        source: 'external_erp_crm_sales_autopopulate',
        label: 'External ERP/CRM sales pattern + compatible customer records',
        sourceUrl: 'https://github.com/mysticalsin/bidstack',
        confidence: 0.84,
      }),
      attribution({
        source: 'external_crm_core_objects',
        label: 'External CRM Company/Opportunity object model',
        sourceUrl: 'https://github.com/mysticalsin/bidstack',
        confidence: 0.86,
      }),
    ],
    warnings,
  };
}
