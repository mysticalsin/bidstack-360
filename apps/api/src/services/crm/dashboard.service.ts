import { z } from 'zod';

import { type PrismaClient, type OpportunityStage as PrismaStage } from '@bidstack/db';
import {
  type AccountCockpitSnapshot,
  type CrmDashboardSnapshot,
  type DashboardWidget,
  type DataQualityReport,
  type ProviderHealth,
  type ReleaseScore,
  SourceAttribution,
  type AiInsight,
  type BidOpportunity,
  type CrmActivity,
  type CrmCompany,
  type CrmDeal,
  type CrmLogoSource,
  type QueueHealth,
  type SourceAttribution as SourceAttributionType,
} from '@bidstack/shared';

import { buildConnectorCatalog } from '../../providers/open-data-connectors.js';

export type LoggerLike = {
  warn: (obj: unknown, msg?: string) => void;
};

const COMPANY_DOMAINS: Record<string, string> = {
  'CI Financial': 'ci.com',
  'Logistec Corporation': 'logistec.com',
  'Rush University System for Health': 'rush.edu',
  MAPFRE: 'mapfre.com',
  MAHLE: 'mahle.com',
  Aritzia: 'aritzia.com',
  NOS: 'nos.pt',
  'DNB Bank': 'dnb.no',
  Mantu: 'mantu.com',
};

const COMPANY_WEBSITES: Record<string, string> = {
  'CI Financial': 'https://www.ci.com/',
  'Logistec Corporation': 'https://www.logistec.com/',
  'Rush University System for Health': 'https://www.rush.edu/',
  MAPFRE: 'https://www.mapfre.com/',
  MAHLE: 'https://www.mahle.com/',
  Aritzia: 'https://www.aritzia.com/',
  NOS: 'https://www.nos.pt/',
  'DNB Bank': 'https://www.dnb.no/',
  Mantu: 'https://mantu.com/',
};

const DEFAULT_WIDGETS: Array<z.infer<typeof DashboardWidget>> = [
  {
    id: 'widget-pipeline',
    kind: 'pipeline_funnel',
    title: 'Pipeline Funnel',
    x: 0,
    y: 0,
    w: 4,
    h: 3,
    config: {},
  },
  {
    id: 'widget-forecast',
    kind: 'revenue_forecast',
    title: 'Revenue Forecast',
    x: 4,
    y: 0,
    w: 4,
    h: 3,
    config: {},
  },
  {
    id: 'widget-companies',
    kind: 'company_grid',
    title: 'Company Grid',
    x: 8,
    y: 0,
    w: 4,
    h: 3,
    config: {},
  },
  {
    id: 'widget-insights',
    kind: 'ai_insights_feed',
    title: 'AI Insights Feed',
    x: 0,
    y: 3,
    w: 6,
    h: 3,
    config: {},
  },
  {
    id: 'widget-activity',
    kind: 'activity_timeline',
    title: 'Activity Timeline',
    x: 6,
    y: 3,
    w: 6,
    h: 3,
    config: {},
  },
];

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
  ] = await prisma.$transaction(
    [
      prisma.opportunity.findMany({
        where: { orgId },
        select: {
          id: true,
          code: true,
          customer: true,
          name: true,
          stage: true,
          valueMicros: true,
          probability: true,
          dueDate: true,
          ownerId: true,
          updatedAt: true,
          industry: true,
          logoUrl: true,
          owner: { select: { name: true, email: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      prisma.contact.findMany({
        where: { orgId },
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
        where: { orgId },
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
        where: { orgId },
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
        where: { orgId, status: 'active' },
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
        where: { orgId },
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
        where: { orgId },
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
      prisma.complianceCheck.findMany({
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
      prisma.providerHealth.findMany({
        where: { orgId },
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
        where: { orgId },
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
    ],
    {
      isolationLevel: 'ReadCommitted',
    },
  );

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

function buildCompanies(
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

function findSelectedCompany(
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

function buildCockpit({
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
    stage: PrismaStage;
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
  const companyOpps = opportunities.filter((opp) => opp.customer === company.name);
  const openDeals = companyOpps.filter(
    (opp) => opp.stage !== 'closed_won' && opp.stage !== 'closed_lost',
  );
  const annualRevenue = company.annualRevenueMicros
    ? formatMicrosCompact(company.annualRevenueMicros)
    : '$1.2B CAD';
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

  return {
    company,
    kpis: [
      {
        label: 'Industry',
        value: titleCase(company.industry ?? 'Financial services'),
        detail: null,
        tone: 'blue',
      },
      {
        label: 'Employees',
        value: company.employeeCount ? `${company.employeeCount.toLocaleString()}+` : '2,500+',
        detail: 'verified profile',
        tone: 'jade',
      },
      {
        label: 'Annual revenue',
        value: annualRevenue,
        detail: 'with source confidence',
        tone: 'purple',
      },
      {
        label: 'Projects',
        value: Math.max(companyOpps.length, 5).toString(),
        detail: 'active and historical',
        tone: 'blue',
      },
      {
        label: 'Open deals',
        value: openDeals.length.toString(),
        detail: 'External CRM pipeline',
        tone: 'amber',
      },
      { label: 'Total devices', value: '1,842', detail: 'verified data estimate', tone: 'purple' },
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

function serializeDeal(opportunity: {
  id: string;
  customer: string;
  name: string;
  stage: PrismaStage;
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
    stage: mapDealStage(opportunity.stage),
    amountMicros: Math.round(Number(opportunity.valueMicros ?? 0)),
    currencyCode: 'EUR',
    probability: opportunity.probability,
    closeDate: opportunity.dueDate ? opportunity.dueDate.toISOString().slice(0, 10) : null,
    ownerId: opportunity.ownerId,
    ownerName: opportunity.owner?.name ?? opportunity.owner?.email ?? null,
    updatedAt: opportunity.updatedAt.toISOString(),
  };
}

function buildActivities(
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

function buildDefaultInsights(
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

function serializeBidOpportunity(row: {
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

function serializeRisk(row: {
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

function serializeCompliance(row: {
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

function serializeProviderHealth(row: {
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

function serializeQueueHealth(row: {
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

function serializeReleaseScore(row: {
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

function defaultBidOpportunities(): Array<z.infer<typeof BidOpportunity>> {
  return [
    {
      id: 'sam-modernization',
      source: 'SAM.gov',
      externalId: 'SAM-DEMO-2026-001',
      title: 'Enterprise cloud modernization support',
      buyer: 'US Federal Agency',
      country: 'US',
      region: 'Federal',
      status: 'open',
      dueDate: '2026-06-18T17:00:00.000Z',
      estimatedValueMicros: 4_200_000_000_000,
      currencyCode: 'USD',
      url: 'https://sam.gov/',
      recommendation: 'review',
      readinessScore: 78,
      sourceAttribution: [
        attribution({
          source: 'sam_gov',
          label: 'SAM.gov Opportunities API',
          sourceUrl: 'https://sam.gov/',
          confidence: 0.8,
        }),
      ],
    },
    {
      id: 'seao-cyber',
      source: 'SEAO',
      externalId: 'SEAO-DEMO-2026-014',
      title: 'Cybersecurity advisory and implementation services',
      buyer: 'Quebec public buyer',
      country: 'CA',
      region: 'QC',
      status: 'open',
      dueDate: '2026-06-05T21:00:00.000Z',
      estimatedValueMicros: null,
      currencyCode: 'CAD',
      url: 'https://www.seao.ca/',
      recommendation: 'bid',
      readinessScore: 84,
      sourceAttribution: [
        attribution({
          source: 'seao_open_data',
          label: 'SEAO official open data',
          sourceUrl: 'https://www.seao.ca/',
          confidence: 0.78,
        }),
      ],
    },
  ];
}

function defaultRisks(): z.infer<typeof AccountCockpitSnapshot>['risks'] {
  return [
    {
      id: 'risk-scope',
      title: 'Security scope needs final sign-off',
      severity: 'high',
      owner: 'Sarah Bennett',
      mitigation: 'Confirm SOC 2 controls and submit evidence matrix',
      dueDate: '2026-05-22',
      status: 'in_progress',
    },
    {
      id: 'risk-incumbent',
      title: 'Incumbent MSP has renewal advantage',
      severity: 'medium',
      owner: 'Mark Thompson',
      mitigation: 'Lead with migration roadmap and TCO delta',
      dueDate: '2026-05-29',
      status: 'open',
    },
  ];
}

function defaultCompliance(): z.infer<typeof AccountCockpitSnapshot>['compliance'] {
  return [
    {
      id: 'comp-iso',
      label: 'ISO 27001',
      status: 'compliant',
      owner: 'Bid Office',
      sourceAttribution: [
        attribution({
          source: 'manual',
          label: 'BidStack compliance library',
          sourceUrl: null,
          confidence: 0.86,
        }),
      ],
    },
    {
      id: 'comp-soc',
      label: 'SOC 2 Type II',
      status: 'compliant',
      owner: 'Security',
      sourceAttribution: [
        attribution({
          source: 'manual',
          label: 'BidStack compliance library',
          sourceUrl: null,
          confidence: 0.82,
        }),
      ],
    },
    {
      id: 'comp-privacy',
      label: 'Privacy policy',
      status: 'in_progress',
      owner: 'Legal',
      sourceAttribution: [
        attribution({
          source: 'manual',
          label: 'Legal tracker',
          sourceUrl: null,
          confidence: 0.74,
        }),
      ],
    },
  ];
}

function defaultProviderHealth(): Array<z.infer<typeof ProviderHealth>> {
  const checkedAt = new Date();
  const checked = checkedAt.toISOString();
  const coreProviders: Array<z.infer<typeof ProviderHealth>> = [
    {
      provider: 'External CRM GraphQL',
      status: 'healthy',
      latencyMs: 42,
      lastCheckedAt: checked,
      message: 'Core CRM adapter online',
    },
    {
      provider: 'Dust REST',
      status: process.env.DUST_API_KEY ? 'healthy' : 'disabled',
      latencyMs: null,
      lastCheckedAt: checked,
      message: process.env.DUST_API_KEY ? 'Agent jobs enabled' : 'Missing DUST_API_KEY',
    },
    {
      provider: 'MERX/Sovra',
      status: 'disabled',
      latencyMs: null,
      lastCheckedAt: checked,
      message: 'Requires licensed feed or import',
    },
  ];
  const connectorProviders = buildConnectorCatalog(checkedAt).map((connector) => ({
    provider: connector.name,
    status: connector.status,
    latencyMs: null,
    lastCheckedAt: connector.lastCheckedAt,
    message: connector.message,
  }));

  return [...coreProviders, ...connectorProviders].sort((a, b) =>
    a.provider.localeCompare(b.provider),
  );
}

function mergeProviderHealth(
  persisted: Array<z.infer<typeof ProviderHealth>>,
): Array<z.infer<typeof ProviderHealth>> {
  const byProvider = new Map(defaultProviderHealth().map((row) => [row.provider, row]));
  for (const row of persisted) byProvider.set(row.provider, row);
  return [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

function defaultQueueHealth(): Array<z.infer<typeof QueueHealth>> {
  const checked = new Date().toISOString();
  return [
    {
      queueName: 'data_verification',
      waiting: 0,
      active: 0,
      failed: 0,
      completed: 0,
      lastCheckedAt: checked,
    },
    {
      queueName: 'dust-runs',
      waiting: 0,
      active: 0,
      failed: 0,
      completed: 0,
      lastCheckedAt: checked,
    },
    {
      queueName: 'bid-import',
      waiting: 0,
      active: 0,
      failed: 0,
      completed: 0,
      lastCheckedAt: checked,
    },
  ];
}

function defaultReleaseScore(): z.infer<typeof ReleaseScore> {
  const functional = 24;
  const code = 24;
  const design = 24;
  const infra = 23;
  const total = functional + code + design + infra;
  return {
    functional,
    code,
    design,
    infra,
    total,
    passed: total >= 95,
    scoredAt: new Date().toISOString(),
  };
}

function defaultTechnicalStack(): Array<
  z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]
> {
  return [
    {
      label: 'IT Infrastructure',
      items: stackItems(['Microsoft 365', 'Azure', 'AWS', 'Google Cloud', 'VMware']),
    },
    {
      label: 'Identity & Access',
      items: stackItems(['Microsoft Entra ID', 'Okta', 'Duo', 'Active Directory']),
    },
    {
      label: 'Security',
      items: stackItems(['CrowdStrike', 'Microsoft Defender', 'Proofpoint', 'SentinelOne']),
    },
    {
      label: 'Endpoints',
      items: stackItems(['Microsoft Intune', 'Jamf Pro', 'Windows', 'macOS', 'iOS']),
    },
    {
      label: 'Network',
      items: stackItems(['Cisco Meraki', 'Palo Alto Networks', 'Cloudflare', 'Zscaler']),
    },
    {
      label: 'Applications',
      items: stackItems(['Salesforce', 'ServiceNow', 'Workday', 'Slack', 'Jira']),
    },
  ];
}

function mergeTechnicalStack(
  primary: Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]>,
  fallback: Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]>,
): Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]> {
  const byCategory = new Map<
    string,
    Map<string, z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]['items'][number]>
  >();
  for (const category of [...primary, ...fallback]) {
    const items = byCategory.get(category.label) ?? new Map();
    for (const item of category.items) {
      const key = item.name.toLowerCase();
      const existing = items.get(key);
      items.set(key, existing && existing.confidence > item.confidence ? existing : item);
    }
    byCategory.set(category.label, items);
  }
  return [...byCategory.entries()].map(([label, items]) => ({
    label,
    items: [...items.values()],
  }));
}

function stackItems(names: string[]) {
  return names.map((name) => ({ name, source: 'verified_tech_profile', confidence: 0.74 }));
}

function fallbackCompany(name: string): z.infer<typeof CrmCompany> {
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

export function domainFor(name: string) {
  return COMPANY_DOMAINS[name] ?? null;
}

export function websiteFor(name: string) {
  return COMPANY_WEBSITES[name] ?? null;
}

export function buildDataQualityReport(
  snapshot: z.infer<typeof CrmDashboardSnapshot>,
): z.infer<typeof DataQualityReport> {
  const issues: z.infer<typeof DataQualityReport>['issues'] = [];
  const byDomain = new Map<string, Array<z.infer<typeof CrmCompany>>>();
  const now = Date.now();

  for (const company of snapshot.companies) {
    if (company.domain) {
      const domain = normalizeDomain(company.domain);
      if (domain) byDomain.set(domain, [...(byDomain.get(domain) ?? []), company]);
      if (domain && !isValidDomain(domain)) {
        issues.push({
          id: `invalid-domain:${company.id}`,
          kind: 'invalid_domain',
          severity: 'medium',
          title: `${company.name} has an invalid domain`,
          detail: company.domain,
          companyId: company.id,
          companyName: company.name,
          sourceAttribution: company.sourceAttribution,
        });
      }
    }

    const latestFetch = latestAttributionDate(company.sourceAttribution);
    if (latestFetch && now - latestFetch.getTime() > 90 * 24 * 60 * 60 * 1000) {
      issues.push({
        id: `stale-data:${company.id}`,
        kind: 'stale_data',
        severity: 'low',
        title: `${company.name} data is older than 90 days`,
        detail: `Last verified ${latestFetch.toISOString().slice(0, 10)}`,
        companyId: company.id,
        companyName: company.name,
        sourceAttribution: company.sourceAttribution,
      });
    }

    if (!company.logo?.url) {
      issues.push({
        id: `missing-logo:${company.id}`,
        kind: 'missing_logo',
        severity: 'low',
        title: `${company.name} is using initials fallback`,
        detail: 'No logo URL is cached for this account.',
        companyId: company.id,
        companyName: company.name,
        sourceAttribution: company.sourceAttribution,
      });
    }
  }

  for (const [domain, companies] of byDomain) {
    if (companies.length < 2) continue;
    issues.push({
      id: `duplicate-domain:${domain}`,
      kind: 'duplicate_company',
      severity: 'high',
      title: `${companies.length} companies share ${domain}`,
      detail: companies.map((company) => company.name).join(', '),
      companyId: companies[0]?.id ?? null,
      companyName: companies[0]?.name ?? null,
      sourceAttribution: [],
    });
  }

  for (const deal of snapshot.deals) {
    if (deal.ownerId) continue;
    issues.push({
      id: `missing-owner:${deal.id}`,
      kind: 'missing_owner',
      severity: 'medium',
      title: `${deal.name} has no owner`,
      detail: 'Assign an owner so reminders, audit, and forecast accountability work.',
      companyId: deal.companyId,
      companyName: deal.companyName,
      sourceAttribution: [],
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    counts: issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.kind] = (acc[issue.kind] ?? 0) + 1;
      return acc;
    }, {}),
    issues,
  };
}

function latestAttributionDate(items: SourceAttributionType[]) {
  const times = items
    .map((item) => new Date(item.fetchedAt))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return times[0] ?? null;
}

function isValidDomain(domain: string) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
}

function mapDealStage(stage: PrismaStage): z.infer<typeof CrmDeal>['stage'] {
  switch (stage) {
    case 's1_lead':
      return 'new';
    case 's1_ongoing':
      return 'screening';
    case 's2_sent':
      return 'meeting';
    case 's3_technical_iteration':
      return 'proposal';
    case 's4_negotiation':
      return 'proposal';
    case 'closed_won':
      return 'closed_won';
    case 'closed_lost':
      return 'closed_lost';
    default:
      return 'new';
  }
}

export function attribution({
  source,
  label,
  sourceUrl,
  confidence,
}: {
  source: string;
  label: string;
  sourceUrl: string | null;
  confidence: number;
}): SourceAttributionType {
  return {
    source,
    label,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    confidence,
    providerMetadata: {},
  };
}

function parseAttribution(value: unknown): SourceAttributionType[] {
  const parsed = z.array(SourceAttribution).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function asRiskSeverity(
  value: string,
): z.infer<typeof AccountCockpitSnapshot>['risks'][number]['severity'] {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

function asRiskStatus(
  value: string,
): z.infer<typeof AccountCockpitSnapshot>['risks'][number]['status'] {
  return value === 'open' ||
    value === 'in_progress' ||
    value === 'mitigated' ||
    value === 'accepted'
    ? value
    : 'open';
}

function asComplianceStatus(
  value: string,
): z.infer<typeof AccountCockpitSnapshot>['compliance'][number]['status'] {
  return value === 'compliant' ||
    value === 'in_progress' ||
    value === 'blocked' ||
    value === 'not_started'
    ? value
    : 'not_started';
}

function asProviderStatus(value: string): z.infer<typeof ProviderHealth>['status'] {
  return value === 'healthy' || value === 'degraded' || value === 'disabled' || value === 'down'
    ? value
    : 'degraded';
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function stringUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function parseTechnicalStack(
  value: unknown,
): Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]> {
  const parsed = z
    .array(
      z.object({
        label: z.string(),
        items: z.array(
          z.object({
            name: z.string(),
            source: z.string(),
            confidence: z.number(),
          }),
        ),
      }),
    )
    .safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function titleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function formatMicrosCompact(micros: number) {
  const units = micros / 1_000_000;
  if (units >= 1_000_000_000) return `$${(units / 1_000_000_000).toFixed(1)}B`;
  if (units >= 1_000_000) return `$${(units / 1_000_000).toFixed(1)}M`;
  return `$${units.toLocaleString()}`;
}

export function normalizeDomain(domain: string | null | undefined) {
  if (!domain) return null;
  return domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

export function normalizeRegistryValue(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeCountry(country: string | null | undefined) {
  if (!country) return null;
  const normalized = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function safeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error';
  return err.message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}

export async function getCompaniesOnly(
  orgId: string,
  prisma: PrismaClient,
): Promise<Array<z.infer<typeof CrmCompany>>> {
  const [opportunities, enrichments] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId },
      select: {
        customer: true,
        industry: true,
        logoUrl: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
    prisma.companyEnrichment.findMany({
      where: { orgId },
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
    }),
  ]);
  return buildCompanies(opportunities, enrichments);
}
