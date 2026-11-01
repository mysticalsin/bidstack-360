/**
 * dashboard.service.ts — top-level orchestrator for the CRM dashboard pipeline.
 *
 * Split from 1 752 lines into 5 focused sibling modules (BS-R1, Wave 10):
 *   dashboard.utils.ts            — pure helpers (normalizers, coercers, buildDataQualityReport)
 *   dashboard.defaults.ts         — static constants and fallback data factories
 *   company-enrichment.service.ts — CrmCompany serializers and builders
 *   dashboard.cockpit.ts          — AccountCockpitSnapshot builder + activity/insight builders
 *   dashboard.queries.ts          — Prisma query wrappers and row serializers
 *   dashboard.providers.ts        — defaultProviderHealth + mergeProviderHealth
 *
 * This file keeps only buildDashboardSnapshot (the 12-query orchestrator).
 * All callers continue to import from THIS path; the re-export block at the
 * bottom ensures backward compatibility without touching any route or service.
 */
import { type z } from 'zod';

import { type PrismaClient } from '@bidstack/db';
import { excludeClosedOutcome } from '../../routes/opportunities.helpers.js';
import type { CrmDashboardSnapshot } from '@bidstack/shared';

import { defaultProviderHealth, mergeProviderHealth } from './dashboard.providers.js';
import {
  accountOpportunityScopePredicate,
  applyCompanyScope,
  applyOpportunityScope,
  type AccessScope,
} from '../../lib/access-scope.js';
import {
  buildCompanies,
  companyFromRow,
  fallbackCompany,
  findSelectedCompany,
} from './company-enrichment.service.js';
import { refreshPublicCompanyFacts } from './enrichment.service.js';
import {
  buildActivities,
  buildCockpit,
  COCKPIT_CONTACT_PAGE,
  COCKPIT_OPP_PAGE,
  COCKPIT_TASK_PAGE,
  mapStoredInsights,
  serializeBidOpportunity,
} from './dashboard.cockpit.js';
import {
  DEFAULT_WIDGETS,
  defaultReleaseScore,
} from './dashboard.defaults.js';
import {
  fetchAccountPerformance,
  fetchBuyingRoleFacts,
  loadAccountCompliance,
  loadAccountRisks,
  serializeDeal,
  serializeProviderHealth,
  serializeQueueHealth,
  serializeReleaseScore,
  serializeWidget,
} from './dashboard.queries.js';
import { normalizeName } from './dashboard.utils.js';

// ─── Logger type ───────────────────────────────────────────────────────────────

const DASHBOARD_ACTIVITY_LIMIT = 12;

function isCompanyUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export type LoggerLike = {
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Company row for `?account=` (id or exact name), honouring the access scope. */
async function findSparseAccount(prisma: PrismaClient, orgId: string, accountId: string, scope?: AccessScope) {
  const base = {
    orgId,
    deletedAt: null,
    OR: [...(UUID.test(accountId) ? [{ id: accountId }] : []), { name: { equals: accountId, mode: 'insensitive' as const } }],
  };
  return prisma.company.findFirst({
    where: scope ? applyCompanyScope(base, scope) : base,
    select: { id: true, name: true, legalName: true, domain: true, website: true, industry: true, employeeCount: true, logoUrl: true, confidence: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
}

// ─── Main orchestrator ─────────────────────────────────────────────────────────

export async function buildDashboardSnapshot(
  orgId: string,
  accountId: string | undefined,
  prisma: PrismaClient,
  logger: LoggerLike,
  scope?: AccessScope,
): Promise<z.infer<typeof CrmDashboardSnapshot>> {
  const opportunityWhere = scope
    ? applyOpportunityScope({ orgId, deletedAt: null }, scope)
    : { orgId, deletedAt: null };
  const taskOpportunityPredicate = scope ? accountOpportunityScopePredicate(scope) : null;
  const taskWhere = taskOpportunityPredicate
    ? { orgId, deletedAt: null, opportunity: taskOpportunityPredicate }
    : { orgId, deletedAt: null };

  const [
    opportunities,
    tasks,
    enrichments,
    persistedInsights,
    widgets,
    bidRows,
    providerRows,
    queueRows,
    releaseScoreRow,
    companyRows,
  ] = await Promise.all([
    prisma.opportunity.findMany({
      where: opportunityWhere,
      select: {
        id: true,
        code: true,
        customer: true,
        companyId: true,
        name: true,
        stage: true,
        pipelineStageId: true,
        valueMicros: true,
        probability: true,
        dueDate: true,
        ownerId: true,
        updatedAt: true,
        industry: true,
        logoUrl: true,
        owner: { select: { name: true, email: true } },
        pipelineStage: {
          select: {
            id: true,
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
    }),
    prisma.task.findMany({
      where: taskWhere,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        opportunity: { select: { id: true, customer: true, companyId: true, name: true } },
        assignee: { select: { name: true, email: true } },
        dueDate: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.companyEnrichment.findMany({
      where: { orgId, deletedAt: null },
      select: {
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
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
    prisma.aiInsight.findMany({
      where: { orgId, status: 'active', deletedAt: null },
      select: {
        id: true,
        kind: true,
        title: true,
        summary: true,
        confidenceBps: true,
        companyName: true,
        opportunityId: true,
        sourceAttribution: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.dashboardWidget.findMany({
      where: { orgId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        title: true,
        x: true,
        y: true,
        w: true,
        h: true,
        config: true,
      },
      orderBy: [{ y: 'asc' }, { x: 'asc' }],
      take: 20,
    }),
    prisma.bidOpportunity.findMany({
      where: { orgId, deletedAt: null },
      select: {
        id: true,
        source: true,
        externalId: true,
        title: true,
        buyer: true,
        country: true,
        region: true,
        status: true,
        dueDate: true,
        estimatedValueMicros: true,
        currencyCode: true,
        url: true,
        recommendation: true,
        readinessScore: true,
        sourceAttribution: true,
      },
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      take: 50,
    }),
    prisma.providerHealth.findMany({
      where: { orgId, deletedAt: null },
      select: {
        provider: true,
        status: true,
        latencyMs: true,
        lastCheckedAt: true,
        message: true,
      },
      orderBy: { provider: 'asc' },
      take: 50,
    }),
    prisma.queueHealth.findMany({
      where: { orgId, deletedAt: null },
      select: {
        queueName: true,
        waiting: true,
        active: true,
        failed: true,
        completed: true,
        lastCheckedAt: true,
      },
      orderBy: { queueName: 'asc' },
      take: 50,
    }),
    prisma.releaseScore.findFirst({
      where: { orgId },
      select: {
        functional: true,
        code: true,
        design: true,
        infra: true,
        scoredAt: true,
      },
      orderBy: { scoredAt: 'desc' },
    }),
    // Authoritative Company rows — domain/logo/id override the opp/enrichment-
    // derived companies so manual edits win and the cockpit resolves by real id.
    prisma.company.findMany({
      where: { orgId, deletedAt: null },
      select: { id: true, name: true, domain: true, logoUrl: true, legalName: true },
      take: 500,
    }),
  ]);

  const visibleCompanyKeys =
    scope && !scope.unrestricted
      ? new Set(opportunities.map((opportunity) => normalizeName(opportunity.customer)))
      : null;
  const visibleOpportunityIds =
    scope && !scope.unrestricted
      ? new Set(opportunities.map((opportunity) => opportunity.id))
      : null;
  const companies = buildCompanies(opportunities, enrichments, companyRows).filter(
    (company) => !visibleCompanyKeys || visibleCompanyKeys.has(normalizeName(company.name)),
  );
  // A requested account with no opportunity or enrichment yet (new, imported or sparse) still
  // gets a cockpit: read its Company row directly, within the caller's account scope.
  if (accountId && !findSelectedCompany(companies, accountId)) {
    const sparse = await findSparseAccount(prisma, orgId, accountId, scope);
    if (sparse) companies.push(companyFromRow(sparse));
  }
  const deals = opportunities.map((opportunity) => serializeDeal(opportunity));
  const activities = buildActivities(tasks).slice(0, DASHBOARD_ACTIVITY_LIMIT);
  const visibleInsights = visibleOpportunityIds
    ? persistedInsights.filter(
        (insight) =>
          insight.opportunityId != null && visibleOpportunityIds.has(insight.opportunityId),
      )
    : persistedInsights;
  const insightOpportunityIds = [
    ...new Set(
      visibleInsights
        .map((insight) => insight.opportunityId)
        .filter((id): id is string => id != null),
    ),
  ];
  const insightOpportunities =
    insightOpportunityIds.length === 0
      ? []
      : await prisma.opportunity.findMany({
          where: { orgId, id: { in: insightOpportunityIds }, deletedAt: null },
          select: { id: true, companyId: true },
          take: insightOpportunityIds.length,
        });
  const insights = mapStoredInsights(
    visibleInsights,
    new Map(insightOpportunities.map((row) => [row.id, row.companyId])),
  );
  const dashboardWidgets = widgets.length ? widgets.map(serializeWidget) : DEFAULT_WIDGETS;
  let selectedCompany =
    findSelectedCompany(companies, accountId) ??
    companies.find((company) => company.name === 'CI Financial') ??
    companies.find((company) => company.name === 'Mantu') ??
    companies[0] ??
    fallbackCompany('Mantu');
  if (accountId) {
    const refreshed = await refreshPublicCompanyFacts({
      orgId,
      company: selectedCompany,
      prisma,
      log: logger,
    });
    if (refreshed) {
      const index = companies.findIndex((company) => company.id === selectedCompany.id);
      selectedCompany = refreshed;
      if (index >= 0) companies[index] = refreshed;
    }
  }
  const accountOpportunityWhere = isCompanyUuid(selectedCompany.id)
    ? scope
      ? applyOpportunityScope(
          { orgId, companyId: selectedCompany.id, deletedAt: null },
          scope,
        )
      : { orgId, companyId: selectedCompany.id, deletedAt: null }
    : null;
  const [fieldOverrides, performance, contacts, accountOpportunities, accountTasks] =
    await Promise.all([
    prisma.companyFieldOverride.findMany({
      where: { orgId, companyKey: normalizeName(selectedCompany.name) },
      select: { fieldKey: true, value: true },
      take: 10,
    }),
    // Account-scoped aggregate — the org-wide `opportunities` array above is
    // a 100-row sample and must NOT back the selected account's win/loss.
    fetchAccountPerformance(orgId, selectedCompany.id, prisma, scope),
    // People for this account only. A 200-row org sample ordered by name
    // dropped linked contacts, and a matching customer string is not a link.
    isCompanyUuid(selectedCompany.id)
      ? prisma.contact.findMany({
          where: { orgId, companyId: selectedCompany.id, deletedAt: null },
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
          take: COCKPIT_CONTACT_PAGE,
        })
      : Promise.resolve([]),
    accountOpportunityWhere
      ? prisma.opportunity.findMany({
          where: accountOpportunityWhere,
          select: {
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
          },
          orderBy: { updatedAt: 'desc' },
          take: COCKPIT_OPP_PAGE,
        })
      : Promise.resolve([]),
    isCompanyUuid(selectedCompany.id) || accountOpportunityWhere
      ? prisma.task.findMany({
          where: {
            orgId,
            deletedAt: null,
            OR: [
              ...(isCompanyUuid(selectedCompany.id) ? [{ accountId: selectedCompany.id }] : []),
              ...(accountOpportunityWhere ? [{ opportunity: accountOpportunityWhere }] : []),
            ],
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
          take: COCKPIT_TASK_PAGE,
        })
      : Promise.resolve([]),
  ]);
  const accountTaskWhere = {
    orgId,
    deletedAt: null as null,
    OR: [
      ...(isCompanyUuid(selectedCompany.id) ? [{ accountId: selectedCompany.id }] : []),
      ...(accountOpportunityWhere ? [{ opportunity: accountOpportunityWhere }] : []),
    ],
  };
  const [dealsCapped, contactsCapped, tasksCapped, openDealCount] = await Promise.all([
    !accountOpportunityWhere || accountOpportunities.length < COCKPIT_OPP_PAGE
      ? Promise.resolve(false)
      : prisma.opportunity.count({ where: accountOpportunityWhere }).then((total) => total > COCKPIT_OPP_PAGE),
    !isCompanyUuid(selectedCompany.id) || contacts.length < COCKPIT_CONTACT_PAGE
      ? Promise.resolve(false)
      : prisma.contact
          .count({ where: { orgId, companyId: selectedCompany.id, deletedAt: null } })
          .then((total) => total > COCKPIT_CONTACT_PAGE),
    accountTasks.length < COCKPIT_TASK_PAGE
      ? Promise.resolve(false)
      : prisma.task.count({ where: accountTaskWhere }).then((total) => total > COCKPIT_TASK_PAGE),
    !accountOpportunityWhere || accountOpportunities.length < COCKPIT_OPP_PAGE
      ? Promise.resolve(undefined)
      : (async () => {
          const total = await prisma.opportunity.count({ where: accountOpportunityWhere });
          if (total <= COCKPIT_OPP_PAGE) return undefined;
          const { NOT } = excludeClosedOutcome();
          return prisma.opportunity.count({
            where: {
              ...accountOpportunityWhere,
              stage: { notIn: ['closed_won', 'closed_lost', 'customer'] },
              NOT,
            },
          });
        })(),
  ]);
  const accountOpportunityIds = accountOpportunities.map((opportunity) => opportunity.id);
  const contactIds = contacts.map((contact) => contact.id);
  const registerWhere = { orgId, deletedAt: null as null, opportunityId: { in: accountOpportunityIds } };
  const [riskPage, compliancePage, buyingRoleFacts] = await Promise.all([
    accountOpportunityIds.length === 0
      ? { rows: [], openCount: 0, capped: false }
      : loadAccountRisks(prisma, registerWhere),
    accountOpportunityIds.length === 0
      ? { rows: [], openCount: 0, capped: false }
      : loadAccountCompliance(prisma, registerWhere),
    fetchBuyingRoleFacts(orgId, contactIds, prisma),
  ]);

  const accountDeals = accountOpportunities.map((opportunity) => serializeDeal(opportunity));
  const snapshotDeals = [
    ...deals.filter((deal) => deal.companyId !== selectedCompany.id),
    ...accountDeals,
  ];

  return {
    generatedAt: new Date().toISOString(),
    cockpit: buildCockpit({
      company: selectedCompany,
      companies,
      opportunities: accountOpportunities,
      contacts,
      tasks: accountTasks,
      risks: riskPage.rows,
      compliance: compliancePage.rows,
      openRiskCount: riskPage.openCount,
      openComplianceCount: compliancePage.openCount,
      risksCapped: riskPage.capped,
      complianceCapped: compliancePage.capped,
      buyingRoleFacts,
      fieldOverrides,
      winLossAvailable: process.env.WIN_LOSS_DATA_AVAILABLE === 'true',
      performance,
      coveragePages: { contactsCapped, dealsCapped, tasksCapped },
      openDealCount,
    }),
    companies,
    deals: snapshotDeals,
    activities,
    insights,
    widgets: dashboardWidgets,
    bidOpportunities: bidRows.map(serializeBidOpportunity),
    providerHealth: providerRows.length
      ? mergeProviderHealth(providerRows.map(serializeProviderHealth))
      : defaultProviderHealth(),
    queueHealth: queueRows.map(serializeQueueHealth),
    releaseScore: releaseScoreRow ? serializeReleaseScore(releaseScoreRow) : defaultReleaseScore(),
  };
}

// ─── Backward-compat re-exports ────────────────────────────────────────────────
// All callers import from this path; we re-export moved symbols so no route
// or service needs to change its import statement.

export {
  attribution,
  buildDataQualityReport,
  normalizeDomain,
  normalizeName,
  normalizeCountry,
  normalizeRegistryValue,
  safeErrorMessage,
  stringArray,
  stringRecord,
  stringUrl,
} from './dashboard.utils.js';

export {
  buildCompanies,
  domainFor,
  fallbackCompany,
  findSelectedCompany,
  logoFor,
  logoUrlFor,
  serializeCompany,
  websiteFor,
} from './company-enrichment.service.js';

export { buildCockpitFromCompany } from './dashboard.cockpit.js';

export { buildCompanyCockpit, getCompaniesOnly, serializeWidget } from './dashboard.queries.js';
