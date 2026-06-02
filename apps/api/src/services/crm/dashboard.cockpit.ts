/**
 * dashboard.cockpit.ts — AccountCockpitSnapshot builder and supporting serializers.
 *
 * WHY a separate module: buildCockpit is the largest pure-transform function in
 * the dashboard pipeline (~162 lines). Isolating it here keeps the query layer
 * thin and makes the cockpit logic independently testable.
 */
import { type z } from 'zod';

import type {
  AccountCockpitSnapshot,
  AiInsight,
  BidOpportunity,
  CrmActivity,
  CrmCompany,
  CrmDashboardSnapshot,
} from '@bidstack/shared';

import { defaultCompliance, defaultRisks, defaultTechnicalStack } from './dashboard.defaults.js';
import {
  asComplianceStatus,
  asRiskSeverity,
  asRiskStatus,
  attribution,
  formatMicrosCompact,
  mergeTechnicalStack,
  normalizeName,
  parseAttribution,
  record,
  titleCase,
} from './dashboard.utils.js';

// ─── Activity serializer ──────────────────────────────────────────────────────

export function buildActivities(
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    opportunity?: { id: string; customer: string; name: string } | null;
    assignee?: { name: string | null; email: string } | null;
    createdAt: Date;
  }>,
): Array<z.infer<typeof CrmActivity>> {
  return tasks.map((task) => ({
    id: task.id,
    source: 'external_crm',
    subject: task.title,
    body: `Task is ${task.status.replace('_', ' ')}.`,
    kind: 'task',
    companyId: task.opportunity ? normalizeName(task.opportunity.customer) : null,
    dealId: task.opportunity?.id ?? null,
    personId: null,
    actorName: task.assignee?.name ?? task.assignee?.email ?? null,
    occurredAt: task.createdAt.toISOString(),
  }));
}

// ─── Default insights ─────────────────────────────────────────────────────────

export function buildDefaultInsights(
  opportunities: Array<{
    id: string;
    customer: string;
    name: string;
    probability: number;
    updatedAt: Date;
  }>,
): Array<z.infer<typeof AiInsight>> {
  const lowest = [...opportunities].sort((a, b) => a.probability - b.probability)[0];
  const largest = [...opportunities].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))[0];
  return [
    {
      id: 'insight-stagnation',
      kind: 'deal_stagnation',
      title: 'Deal stagnation watch',
      summary: lowest
        ? `${lowest.customer} needs a next-step owner before the close plan ages out.`
        : 'No open opportunity risk detected.',
      confidence: 0.78,
      companyId: lowest ? normalizeName(lowest.customer) : null,
      companyName: lowest?.customer ?? null,
      dealId: lowest?.id ?? null,
      sourceAttribution: [
        attribution({
          source: 'bidstack_rules',
          label: 'Pipeline velocity model',
          sourceUrl: null,
          confidence: 0.78,
        }),
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'insight-upsell',
      kind: 'funding_upsell',
      title: 'Funding and award upsell signal',
      summary: largest
        ? `${largest.customer} has enough active motion to justify a managed-security expansion play.`
        : 'No funding signal available yet.',
      confidence: 0.71,
      companyId: largest ? normalizeName(largest.customer) : null,
      companyName: largest?.customer ?? null,
      dealId: largest?.id ?? null,
      sourceAttribution: [
        attribution({
          source: 'verified_source_registry',
          label: 'SAM/TED/USAspending adapter registry',
          sourceUrl: null,
          confidence: 0.71,
        }),
      ],
      createdAt: new Date().toISOString(),
    },
  ];
}

// ─── Risk / compliance serializers ────────────────────────────────────────────

export function serializeRisk(row: {
  id: string;
  title: string;
  severity: string;
  owner: string | null;
  mitigation: string | null;
  dueDate: Date | null;
  status: string;
}): z.infer<typeof AccountCockpitSnapshot>['risks'][number] {
  return {
    id: row.id,
    title: row.title,
    severity: asRiskSeverity(row.severity),
    owner: row.owner,
    mitigation: row.mitigation,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    status: asRiskStatus(row.status),
  };
}

export function serializeCompliance(row: {
  id: string;
  label: string;
  status: string;
  owner: string | null;
  sourceAttribution: unknown;
}): z.infer<typeof AccountCockpitSnapshot>['compliance'][number] {
  return {
    id: row.id,
    label: row.label,
    status: asComplianceStatus(row.status),
    owner: row.owner,
    sourceAttribution: parseAttribution(row.sourceAttribution),
  };
}

// ─── Bid opportunity serializer ───────────────────────────────────────────────

export function serializeBidOpportunity(row: {
  id: string;
  source: string;
  externalId: string;
  title: string;
  buyer: string | null;
  country: string | null;
  region: string | null;
  status: string;
  dueDate: Date | null;
  estimatedValueMicros: bigint | null;
  currencyCode: string | null;
  url: string | null;
  recommendation: string | null;
  readinessScore: number | null;
  sourceAttribution: unknown;
}): z.infer<typeof BidOpportunity> {
  return {
    id: row.id,
    source: row.source,
    externalId: row.externalId,
    title: row.title,
    buyer: row.buyer,
    country: row.country,
    region: row.region,
    status: row.status,
    dueDate: row.dueDate?.toISOString() ?? null,
    estimatedValueMicros:
      row.estimatedValueMicros === null ? null : Number(row.estimatedValueMicros),
    currencyCode: row.currencyCode,
    url: row.url,
    recommendation: row.recommendation as z.infer<typeof BidOpportunity>['recommendation'],
    readinessScore: row.readinessScore,
    sourceAttribution: parseAttribution(row.sourceAttribution),
  };
}

// ─── Main cockpit builder ─────────────────────────────────────────────────────

export function buildCockpit({
  company,
  opportunities,
  contacts,
  tasks,
  risks,
  compliance,
}: {
  company: z.infer<typeof CrmCompany>;
  companies: Array<z.infer<typeof CrmCompany>>;
  opportunities: Array<{
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
    owner: { name: string | null; email: string } | null;
  }>;
  contacts: Array<{
    id: string;
    customer: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
    influence: number | null;
    createdAt: Date;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    dueDate: Date | null;
    opportunity: { customer: string; id: string; name: string } | null;
    assignee: { name: string | null; email: string } | null;
    createdAt: Date;
  }>;
  risks: Array<{
    id: string;
    title: string;
    severity: string;
    owner: string | null;
    mitigation: string | null;
    dueDate: Date | null;
    status: string;
    companyName: string | null;
  }>;
  compliance: Array<{
    id: string;
    label: string;
    status: string;
    owner: string | null;
    sourceAttribution: unknown;
  }>;
}): z.infer<typeof AccountCockpitSnapshot> {
  const companyOpps = opportunities.filter((opp) => {
    const opportunityCompanyKey = normalizeName(opp.customer);
    return opp.customer === company.name || opportunityCompanyKey === company.id;
  });
  const openDeals = companyOpps.filter(
    (opp) =>
      !opp.pipelineStage?.isWon &&
      !opp.pipelineStage?.isLost &&
      opp.stage !== 'customer' &&
      opp.stage !== 'closed_won' &&
      opp.stage !== 'closed_lost',
  );
  const annualRevenue = company.annualRevenueMicros
    ? formatMicrosCompact(company.annualRevenueMicros)
    : 'Not verified';
  const companyRisks = risks.filter(
    (risk) => risk.companyName && normalizeName(risk.companyName) === normalizeName(company.name),
  );
  const visibleRisks = companyRisks.length ? companyRisks : risks;
  const companyCompliance = compliance.filter((check) =>
    parseAttribution(check.sourceAttribution).some(
      (source) => record(source.providerMetadata).companyName === company.name,
    ),
  );
  const visibleCompliance = companyCompliance.length ? companyCompliance : compliance;
  const apolloIntel = company.strategicIntel;
  const apolloLastSyncedAt = apolloIntel?.lastSyncedAt ?? null;
  const apolloSource =
    apolloIntel?.freshness === 'fresh' && apolloLastSyncedAt
      ? {
          sourceLabel: 'Apollo fresh',
          sourceState: 'apollo_fresh' as const,
          sourceHint: `Synced ${apolloLastSyncedAt.slice(0, 10)}`,
        }
      : apolloIntel?.freshness === 'stale' && apolloLastSyncedAt
        ? {
            sourceLabel: 'Apollo stale',
            sourceState: 'apollo_stale' as const,
            sourceHint: `Last synced ${apolloLastSyncedAt.slice(0, 10)}`,
          }
        : {
            sourceLabel: 'Needs Apollo',
            sourceState: 'missing' as const,
            sourceHint: 'Connect Apollo MCP/API to refresh this field.',
          };
  const verifiedSource = {
    sourceLabel: company.source === 'verified_data' ? 'Verified' : 'CRM',
    sourceState: company.source === 'verified_data' ? ('verified' as const) : ('crm' as const),
    sourceHint:
      company.source === 'verified_data'
        ? 'Verified company cache'
        : 'BidStack CRM pipeline record',
  };
  const missingApolloSource = {
    sourceLabel: 'Needs Apollo',
    sourceState: 'missing' as const,
    sourceHint: 'Connect Apollo MCP/API to verify this company attribute.',
  };
  const fieldSource = (hasValue: boolean) =>
    hasValue ? (apolloIntel ? apolloSource : verifiedSource) : missingApolloSource;
  const crmSource = {
    sourceLabel: 'CRM',
    sourceState: 'crm' as const,
    sourceHint: 'Computed from BidStack opportunities.',
  };

  return {
    company,
    kpis: [
      {
        label: 'Industry',
        value: company.industry ? titleCase(company.industry) : 'Not verified',
        detail: company.industry ? 'company profile' : 'connect Apollo to verify',
        tone: 'blue',
        ...fieldSource(Boolean(company.industry)),
      },
      {
        label: 'Employees',
        value: company.employeeCount
          ? `${company.employeeCount.toLocaleString()}+`
          : 'Not verified',
        detail: company.employeeCount ? 'company headcount' : 'connect Apollo to verify',
        tone: company.employeeCount ? 'jade' : 'amber',
        ...fieldSource(Boolean(company.employeeCount)),
      },
      {
        label: 'Annual revenue',
        value: annualRevenue,
        detail: company.annualRevenueMicros ? 'company revenue' : 'connect Apollo to verify',
        tone: company.annualRevenueMicros ? 'purple' : 'amber',
        ...fieldSource(Boolean(company.annualRevenueMicros)),
      },
      {
        label: 'Projects',
        value: companyOpps.length.toString(),
        detail: 'active and historical',
        tone: 'blue',
        ...crmSource,
      },
      {
        label: 'Open deals',
        value: openDeals.length.toString(),
        detail: 'External CRM pipeline',
        tone: 'amber',
        ...crmSource,
      },
      {
        label: 'Apollo sync',
        value:
          apolloIntel?.freshness === 'fresh'
            ? 'Fresh'
            : apolloIntel?.freshness === 'stale'
              ? 'Stale'
              : 'Not synced',
        detail: apolloIntel ? apolloIntel.creditPolicy.replace('_', ' ') : 'connect in Settings',
        tone: apolloIntel?.freshness === 'fresh' ? 'jade' : 'amber',
        ...(apolloIntel ? apolloSource : missingApolloSource),
      },
    ],
    technicalStack: mergeTechnicalStack(company.technicalStack ?? [], defaultTechnicalStack()),
    health: {
      score: 72,
      band: 'strong',
      counts: { strong: 12, good: 18, needs_attention: 7, critical: 3 },
    },
    keyContacts: contacts
      .filter((contact) => contact.customer === company.name)
      .slice(0, 5)
      .map((contact) => ({
        id: contact.id,
        source: 'external_crm',
        companyId: company.id,
        name: contact.name,
        title: contact.role,
        email: contact.email,
        phone: contact.phone,
        influence: contact.influence,
        roleInDecision: contact.influence && contact.influence >= 5 ? 'champion' : 'influencer',
        updatedAt: contact.createdAt.toISOString(),
      })),
    recentActivity: buildActivities(
      tasks.filter((task) => task.opportunity?.customer === company.name),
    ).slice(0, 5),
    risks: visibleRisks.length ? visibleRisks.map(serializeRisk) : defaultRisks(),
    compliance: visibleCompliance.length
      ? visibleCompliance.map(serializeCompliance)
      : defaultCompliance(),
    roadmap: [
      { id: 'road-q1', quarter: 'Q1 2026', title: 'Windows 11 migration', status: 'in_progress' },
      { id: 'road-q2', quarter: 'Q2 2026', title: 'Zero Trust initiative', status: 'planned' },
      { id: 'road-q3', quarter: 'Q3 2026', title: 'Data center modernization', status: 'planned' },
      { id: 'road-q4', quarter: 'Q4 2026', title: 'Endpoint security upgrade', status: 'planned' },
    ],
  };
}

// ─── Cockpit derivation from snapshot ────────────────────────────────────────

export function buildCockpitFromCompany(
  snapshot: z.infer<typeof CrmDashboardSnapshot>,
  company: z.infer<typeof CrmCompany>,
) {
  if (company.id === snapshot.cockpit.company.id) return snapshot.cockpit;
  return {
    ...snapshot.cockpit,
    company,
    keyContacts: snapshot.cockpit.keyContacts.filter((contact) => contact.companyId === company.id),
  };
}
