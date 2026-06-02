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
import type { AiInsight, CrmDashboardSnapshot } from '@bidstack/shared';

import { defaultProviderHealth, mergeProviderHealth } from './dashboard.providers.js';
import {
  buildCompanies,
  fallbackCompany,
  findSelectedCompany,
} from './company-enrichment.service.js';
import {
  buildActivities,
  buildCockpit,
  buildDefaultInsights,
  serializeBidOpportunity,
} from './dashboard.cockpit.js';
import {
  DEFAULT_WIDGETS,
  defaultBidOpportunities,
  defaultQueueHealth,
  defaultReleaseScore,
} from './dashboard.defaults.js';
import {
  serializeDeal,
  serializeProviderHealth,
  serializeQueueHealth,
  serializeReleaseScore,
  serializeWidget,
} from './dashboard.queries.js';
import { normalizeName, parseAttribution } from './dashboard.utils.js';

// ─── Logger type ───────────────────────────────────────────────────────────────

export type LoggerLike = {
  warn: (obj: unknown, msg?: string) => void;
};

// ─── Main orchestrator ─────────────────────────────────────────────────────────

export async function buildDashboardSnapshot(
  orgId: string,
  accountId: string | undefined,
  prisma: PrismaClient,
  _logger: LoggerLike,
): Promise<z.infer<typeof CrmDashboardSnapshot>> {
  const [
    opportunities,
    contacts,
    tasks,
    enrichments,
    persistedInsights,
    widgets,
    bidRows,
    riskRows,
    complianceRows,
    providerRows,
    queueRows,
    releaseScoreRow,
  ] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId, deletedAt: null },
      select: {
        id: true,
        code: true,
        customer: true,
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
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.contact.findMany({
      where: { orgId, deletedAt: null },
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
      take: 200,
    }),
    prisma.task.findMany({
      where: { orgId, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        opportunity: { select: { id: true, customer: true, name: true } },
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
    prisma.riskRegisterItem.findMany({
      where: { orgId, deletedAt: null },
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
    prisma.complianceCheck.findMany({
      where: { orgId, deletedAt: null },
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
  ]);

  const companies = buildCompanies(opportunities, enrichments);
  const deals = opportunities.map((opportunity) => serializeDeal(opportunity));
  const activities = buildActivities(tasks);
  const insights = persistedInsights.length
    ? persistedInsights.map((insight) => ({
        id: insight.id,
        kind: insight.kind as z.infer<typeof AiInsight>['kind'],
        title: insight.title,
        summary: insight.summary,
        confidence: insight.confidenceBps / 10_000,
        companyId: insight.companyName ? normalizeName(insight.companyName) : null,
        companyName: insight.companyName,
        dealId: insight.opportunityId,
        sourceAttribution: parseAttribution(insight.sourceAttribution),
        createdAt: insight.createdAt.toISOString(),
      }))
    : buildDefaultInsights(opportunities);
  const dashboardWidgets = widgets.length ? widgets.map(serializeWidget) : DEFAULT_WIDGETS;
  const selectedCompany =
    findSelectedCompany(companies, accountId) ??
    companies.find((company) => company.name === 'CI Financial') ??
    companies.find((company) => company.name === 'Mantu') ??
    companies[0] ??
    fallbackCompany('Mantu');

  return {
    generatedAt: new Date().toISOString(),
    cockpit: buildCockpit({
      company: selectedCompany,
      companies,
      opportunities,
      contacts,
      tasks,
      risks: riskRows,
      compliance: complianceRows,
    }),
    companies,
    deals,
    activities,
    insights,
    widgets: dashboardWidgets,
    bidOpportunities: bidRows.length
      ? bidRows.map(serializeBidOpportunity)
      : defaultBidOpportunities(),
    providerHealth: providerRows.length
      ? mergeProviderHealth(providerRows.map(serializeProviderHealth))
      : defaultProviderHealth(),
    queueHealth: queueRows.length ? queueRows.map(serializeQueueHealth) : defaultQueueHealth(),
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
