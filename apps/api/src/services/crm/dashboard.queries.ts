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

import { Prisma, type PrismaClient } from '@bidstack/db';
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
import { buildCockpit, type AccountPerformance } from './dashboard.cockpit.js';
import { asProviderStatus, mapDealStage, normalizeName, record } from './dashboard.utils.js';

// ─── Row serializers ──────────────────────────────────────────────────────────

export function serializeDeal(opportunity: {
  id: string;
  customer: string;
  name: string;
  stage: string;
  pipelineStage: {
    key: string;
    name: string;
    probability: number | unknown;
    color: string | null;
    isWon: boolean;
    isLost: boolean;
  } | null;
  valueMicros: bigint | number | unknown;
  probability: number;
  dueDate: Date | null;
  ownerId: string | null;
  owner: { name: string | null; email: string } | null;
  updatedAt: Date;
}): z.infer<typeof CrmDeal> {
  return {
    id: opportunity.id,
    source: 'external_crm',
    companyId: normalizeName(opportunity.customer),
    companyName: opportunity.customer,
    name: opportunity.name,
    stage: mapDealStage(opportunity.pipelineStage?.key ?? opportunity.stage),
    amountMicros: Math.round(Number(opportunity.valueMicros ?? 0)),
    currencyCode: 'EUR',
    probability: opportunity.probability,
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

export async function getCompaniesOnly(
  orgId: string,
  prisma: PrismaClient,
): Promise<Array<z.infer<typeof CrmCompany>>> {
  const [opportunities, enrichments] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId },
      select: OPP_COMPANY_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
    prisma.companyEnrichment.findMany({
      where: { orgId },
      select: ENRICHMENT_SELECT,
      take: 500,
    }),
  ]);
  return buildCompanies(opportunities, enrichments);
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
  // A UUID that isn't an enrichment can't be an opportunity-only company — those
  // are keyed by normalized name, not a UUID.
  if (isUuid) return null;
  // Opportunity-only company: no normalized column to index on, so match within
  // a bounded set of distinct customers (kept under the dev query-guard's 1000
  // cap; ~5x the old 200 window).
  const opportunities = await prisma.opportunity.findMany({
    where: { orgId },
    select: OPP_COMPANY_SELECT,
    orderBy: { updatedAt: 'desc' },
    distinct: ['customer'],
    take: 1000,
  });
  return buildCompanies(opportunities, []).find((c) => c.id === companyId) ?? null;
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
): Promise<z.infer<typeof AccountCockpitSnapshot> | null> {
  // Step 1: resolve the single company by indexed lookup (was a full-org scan
  // that also capped visibility at the top 200 opps / 500 enrichments).
  const company = await resolveCockpitCompany(orgId, companyId, prismaClient);
  if (!company) return null;

  // Step 2: load company-specific data in parallel (filtered by company)
  const [opportunities, contacts, tasks, riskRows, complianceRows, performance] = await Promise.all([
    prismaClient.opportunity.findMany({
      where: { orgId, customer: company.name, deletedAt: null },
      select: {
        id: true,
        customer: true,
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
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prismaClient.contact.findMany({
      where: { orgId, customer: company.name },
      select: {
        id: true,
        customer: true,
        name: true,
        role: true,
        email: true,
        phone: true,
        influence: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
      take: 20,
    }),
    prismaClient.task.findMany({
      where: { orgId, opportunity: { customer: company.name } },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        dueDate: true,
        opportunity: { select: { id: true, customer: true, name: true } },
        assignee: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    // WHY: risks and compliance can't be cheaply filtered at DB layer — risks may have
    // casing variations and compliance uses JSON attribution metadata. Load the full org
    // set (take: 50) and let buildCockpit's in-memory filter select the right rows.
    prismaClient.riskRegisterItem.findMany({
      where: { orgId },
      select: {
        id: true,
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
    prismaClient.complianceCheck.findMany({
      where: { orgId },
      select: {
        id: true,
        label: true,
        status: true,
        owner: true,
        sourceAttribution: true,
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 50,
    }),
    fetchAccountPerformance(orgId, company.name, prismaClient),
  ]);

  const fieldOverrides = await prismaClient.companyFieldOverride.findMany({
    where: { orgId, companyKey: normalizeName(company.name) },
    select: { fieldKey: true, value: true },
    take: 10,
  });

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
    fieldOverrides,
    winLossAvailable: process.env.WIN_LOSS_DATA_AVAILABLE === 'true',
    performance,
  });
}

/**
 * Exact win/loss + revenue-by-month for ONE account, computed in Postgres so
 * the numbers are correct regardless of how many opportunities the account has
 * (the cockpit's opportunity list is take-capped for display; aggregates must
 * not be). Sums are BigInt in SQL, returned as Number micros at the edge.
 */
export async function fetchAccountPerformance(
  orgId: string,
  customer: string,
  prismaClient: PrismaClient,
): Promise<AccountPerformance> {
  const [byStage, revenueRows] = await Promise.all([
    prismaClient.opportunity.groupBy({
      by: ['stage'],
      where: { orgId, customer, deletedAt: null, stage: { in: ['closed_won', 'closed_lost'] } },
      _sum: { valueMicros: true },
      _count: { _all: true },
    }),
    prismaClient.$queryRaw<Array<{ period: string; revenue: bigint | null }>>(Prisma.sql`
      SELECT to_char(date_trunc('month', due_date), 'YYYY-MM') AS period,
             SUM(value_micros) AS revenue
      FROM opportunities
      WHERE org_id = ${orgId}::uuid
        AND customer = ${customer}
        AND stage = 'closed_won'
        AND deleted_at IS NULL
        AND due_date IS NOT NULL
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 12
    `),
  ]);

  const won = byStage.find((r) => r.stage === 'closed_won');
  const lost = byStage.find((r) => r.stage === 'closed_lost');
  const wonCount = won?._count._all ?? 0;
  const lostCount = lost?._count._all ?? 0;
  const decided = wonCount + lostCount;

  return {
    winLoss: {
      wonCount,
      lostCount,
      wonValueMicros: Number(won?._sum.valueMicros ?? 0),
      lostValueMicros: Number(lost?._sum.valueMicros ?? 0),
      winRate: decided > 0 ? Math.round((wonCount / decided) * 100) : 0,
    },
    // Raw query returns newest-first (for the LIMIT 12 window); the chart wants
    // oldest-first.
    revenueEvolution: revenueRows
      .map((r) => ({ period: r.period, revenueMicros: Number(r.revenue ?? 0) }))
      .reverse(),
  };
}
