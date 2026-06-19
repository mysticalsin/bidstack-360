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
  CompanyHealth,
  CrmActivity,
  CrmCompany,
  CrmDashboardSnapshot,
  SignalFactor,
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
import { TECHNICAL_STACK_FIELD_KEY, parseTechnicalStackOverride } from './technical-stack.service.js';

const COCKPIT_RISK_LIMIT = 6;
const COCKPIT_COMPLIANCE_LIMIT = 6;

// ─── Signal coverage (M2) ─────────────────────────────────────────────────────
// Real 4-factor scoring replacing the old hardcoded 72/strong placeholder.
// Each factor carries what it measures and the action a manager should take.

type HealthBandValue = z.infer<typeof SignalFactor>['band'];

function bandFor(score: number): HealthBandValue {
  if (score >= 75) return 'strong';
  if (score >= 50) return 'good';
  if (score >= 25) return 'needs_attention';
  return 'critical';
}

const FACTOR_ACTIONS: Record<
  z.infer<typeof SignalFactor>['key'],
  Record<'low' | 'high', string>
> = {
  firmographics: {
    low: 'Run an Apollo enrichment (Enrich now) to fill industry, headcount, and revenue.',
    high: 'Profile is well covered — re-sync Apollo if older than two weeks.',
  },
  contacts: {
    low: 'Map more stakeholders: add contacts with roles and influence ratings.',
    high: 'Contact map is healthy — confirm the champion before the next milestone.',
  },
  engagement: {
    low: 'No recent activity — schedule a touchpoint or log the latest interaction.',
    high: 'Engagement cadence is active — keep follow-ups inside their due dates.',
  },
  pipeline: {
    low: 'Open deals are missing stage, owner, or close-date data — complete them.',
    high: 'Pipeline records are complete — review probabilities at the next review.',
  },
};

function factor(
  key: z.infer<typeof SignalFactor>['key'],
  label: string,
  whatItMeasures: string,
  score: number,
): z.infer<typeof SignalFactor> {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandFor(clamped);
  return {
    key,
    label,
    whatItMeasures,
    recommendedAction:
      FACTOR_ACTIONS[key][band === 'strong' || band === 'good' ? 'high' : 'low'],
    score: clamped,
    band,
  };
}

export function computeSignalCoverage(input: {
  company: z.infer<typeof CrmCompany>;
  contacts: Array<{ influence: number | null; email: string | null }>;
  openDeals: Array<{ probability: number; dueDate: Date | null; owner: unknown | null }>;
  tasks: Array<{ status: string; dueDate: Date | null; createdAt: Date }>;
}): CompanyHealth {
  const { company, contacts, openDeals, tasks } = input;

  const freshness = company.strategicIntel?.freshness;
  const firmographics = factor(
    'firmographics',
    'Firmographic coverage',
    'Industry, headcount, revenue, tech stack, and external-source freshness.',
    (company.industry ? 20 : 0) +
      (company.employeeCount ? 20 : 0) +
      (company.annualRevenueMicros ? 20 : 0) +
      ((company.technicalStack?.length ?? 0) > 0 ? 15 : 0) +
      (freshness === 'fresh' ? 25 : freshness === 'stale' ? 10 : 0),
  );

  const withEmail = contacts.filter((c) => c.email).length;
  const contactFactor = factor(
    'contacts',
    'Contact coverage',
    'Stakeholders mapped, influence rated, and reachable by email.',
    Math.min(40, contacts.length * 10) +
      (contacts.some((c) => (c.influence ?? 0) >= 4)
        ? 30
        : contacts.some((c) => c.influence != null)
          ? 15
          : 0) +
      (contacts.length > 0 ? Math.round((withEmail / contacts.length) * 30) : 0),
  );

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const recent = tasks.filter((t) => now - t.createdAt.getTime() < thirtyDays).length;
  const open = tasks.filter((t) => t.status !== 'done');
  const onTrack = open.filter((t) => !t.dueDate || t.dueDate.getTime() >= now).length;
  const engagement = factor(
    'engagement',
    'Engagement recency',
    'Activity in the last 30 days and follow-ups still inside their due dates.',
    Math.min(50, recent * 17) + (open.length > 0 ? Math.round((onTrack / open.length) * 50) : 25),
  );

  const complete = openDeals.filter(
    (d) => d.probability > 0 && d.dueDate != null && d.owner != null,
  ).length;
  const pipeline = factor(
    'pipeline',
    'Pipeline data quality',
    'Open deals carrying probability, owner, and an expected close date.',
    (openDeals.length > 0 ? 40 : 0) +
      (openDeals.length > 0 ? Math.round((complete / openDeals.length) * 60) : 0),
  );

  const factors = [firmographics, contactFactor, engagement, pipeline];
  // Weights: external intel is the cockpit's backbone; the rest split evenly.
  const score = Math.round(
    firmographics.score * 0.3 +
      contactFactor.score * 0.25 +
      engagement.score * 0.2 +
      pipeline.score * 0.25,
  );
  const counts: Record<string, number> = {
    strong: 0,
    good: 0,
    needs_attention: 0,
    critical: 0,
  };
  for (const f of factors) counts[f.band] = (counts[f.band] ?? 0) + 1;
  return { score, band: bandFor(score), counts, factors };
}

// ─── Account performance (win/loss + revenue) ────────────────────────────────

export interface AccountPerformance {
  winLoss: {
    wonCount: number;
    lostCount: number;
    wonValueMicros: number;
    lostValueMicros: number;
    winRate: number;
  };
  revenueEvolution: Array<{ period: string; revenueMicros: number }>;
}

/**
 * Derive win/loss + revenue-by-month from an in-memory opportunity array.
 * Used by unit tests and as a fallback; production callers pass an exact
 * Postgres aggregate instead (the array can be take-capped). Won/lost honor
 * either the pipelineStage flags or the canonical `stage` column.
 */
export function deriveAccountPerformance(
  opps: Array<{
    stage: string;
    valueMicros: bigint | number | unknown;
    dueDate: Date | null | unknown;
    pipelineStage?: { isWon: boolean; isLost: boolean } | null;
  }>,
): AccountPerformance {
  const toMicros = (v: bigint | number | unknown): number =>
    typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : 0;
  const wonOpps = opps.filter((o) => o.pipelineStage?.isWon || o.stage === 'closed_won');
  const lostOpps = opps.filter((o) => o.pipelineStage?.isLost || o.stage === 'closed_lost');
  const decided = wonOpps.length + lostOpps.length;

  const revenueByMonth = new Map<string, number>();
  for (const o of wonOpps) {
    const when = o.dueDate ?? null;
    if (!when) continue;
    const d = when instanceof Date ? when : new Date(when as string);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + toMicros(o.valueMicros));
  }
  return {
    winLoss: {
      wonCount: wonOpps.length,
      lostCount: lostOpps.length,
      wonValueMicros: wonOpps.reduce((s, o) => s + toMicros(o.valueMicros), 0),
      lostValueMicros: lostOpps.reduce((s, o) => s + toMicros(o.valueMicros), 0),
      winRate: decided > 0 ? Math.round((wonOpps.length / decided) * 100) : 0,
    },
    revenueEvolution: [...revenueByMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([period, revenueMicros]) => ({ period, revenueMicros })),
  };
}

// ─── Field overrides (M1) ─────────────────────────────────────────────────────

export interface CockpitFieldOverride {
  fieldKey: string;
  value: unknown;
}

/** Apply manual overrides on top of the (immutable) enrichment-derived company. */
export function applyFieldOverrides(
  company: z.infer<typeof CrmCompany>,
  overrides: CockpitFieldOverride[],
): { company: z.infer<typeof CrmCompany>; overriddenKeys: Set<string> } {
  const overriddenKeys = new Set<string>();
  if (overrides.length === 0) return { company, overriddenKeys };
  const next = { ...company };
  for (const o of overrides) {
    if (o.fieldKey === 'industry' && typeof o.value === 'string' && o.value) {
      next.industry = o.value;
      overriddenKeys.add('industry');
    } else if (o.fieldKey === 'employeeCount' && typeof o.value === 'number' && o.value > 0) {
      next.employeeCount = Math.round(o.value);
      overriddenKeys.add('employeeCount');
    } else if (
      o.fieldKey === 'annualRevenueMicros' &&
      typeof o.value === 'number' &&
      o.value > 0
    ) {
      next.annualRevenueMicros = o.value;
      overriddenKeys.add('annualRevenueMicros');
    }
  }
  return { company: next, overriddenKeys };
}

function resolveCockpitTechnicalStack(
  providerStack: z.infer<typeof AccountCockpitSnapshot>['technicalStack'],
  overrides: CockpitFieldOverride[],
): z.infer<typeof AccountCockpitSnapshot>['technicalStack'] {
  const technicalStackOverride = parseTechnicalStackOverride(
    overrides.find((override) => override.fieldKey === TECHNICAL_STACK_FIELD_KEY)?.value,
  );
  if (technicalStackOverride) return technicalStackOverride.stack;
  return mergeTechnicalStack(providerStack, defaultTechnicalStack());
}

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

function uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function riskKey(row: {
  title: string;
  severity: string;
  status: string;
  companyName: string | null;
}) {
  return [
    normalizeName(row.companyName ?? 'portfolio'),
    normalizeName(row.title),
    row.severity,
    row.status,
  ].join(':');
}

function complianceKey(row: { label: string; sourceAttribution: unknown }) {
  const companyName =
    parseAttribution(row.sourceAttribution)
      .map((source) => record(source.providerMetadata).companyName)
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0) ??
    'portfolio';
  return `${normalizeName(companyName)}:${normalizeName(row.label)}`;
}

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
  company: rawCompany,
  opportunities,
  contacts,
  tasks,
  risks,
  compliance,
  fieldOverrides = [],
  winLossAvailable = false,
  performance,
}: {
  company: z.infer<typeof CrmCompany>;
  fieldOverrides?: CockpitFieldOverride[];
  /** WIN_LOSS_DATA_AVAILABLE flag — when false the won/lost KPI is omitted entirely. */
  winLossAvailable?: boolean;
  /**
   * Exact win/loss + revenue-by-month from Postgres aggregates (account-scoped,
   * uncapped). Production callers pass this so the numbers don't depend on the
   * take-capped `opportunities` array; when absent (unit tests) the values are
   * derived from the passed opportunities instead.
   */
  performance?: AccountPerformance;
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
  const { company, overriddenKeys } = applyFieldOverrides(rawCompany, fieldOverrides);
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
  const visibleRisks = uniqueBy(companyRisks, riskKey).slice(0, COCKPIT_RISK_LIMIT);
  const companyCompliance = compliance.filter((check) =>
    parseAttribution(check.sourceAttribution).some(
      (source) => record(source.providerMetadata).companyName === company.name,
    ),
  );
  const visibleCompliance = uniqueBy(companyCompliance, complianceKey).slice(
    0,
    COCKPIT_COMPLIANCE_LIMIT,
  );
  const apolloIntel = company.strategicIntel;
  const apolloLastSyncedAt = apolloIntel?.lastSyncedAt ?? null;
  const apolloSource =
    apolloIntel?.freshness === 'fresh' && apolloLastSyncedAt
      ? {
          sourceLabel: 'External · fresh',
          sourceState: 'apollo_fresh' as const,
          sourceHint: `Synced ${apolloLastSyncedAt.slice(0, 10)}`,
        }
      : apolloIntel?.freshness === 'stale' && apolloLastSyncedAt
        ? {
            sourceLabel: 'External · stale',
            sourceState: 'apollo_stale' as const,
            sourceHint: `Last synced ${apolloLastSyncedAt.slice(0, 10)}`,
          }
        : {
            sourceLabel: 'Needs enrichment',
            sourceState: 'missing' as const,
            sourceHint: 'Connect an external data source in Settings to refresh this field.',
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
    sourceLabel: 'Needs enrichment',
    sourceState: 'missing' as const,
    sourceHint: 'Connect an external data source in Settings to verify this attribute.',
  };
  const fieldSource = (hasValue: boolean) =>
    hasValue ? (apolloIntel ? apolloSource : verifiedSource) : missingApolloSource;
  const internalSource = {
    sourceLabel: 'Internal',
    sourceState: 'crm' as const,
    sourceHint: 'Computed from BidStack opportunities.',
  };
  const overrideSource = {
    sourceLabel: 'Manual override',
    sourceState: 'verified' as const,
    sourceHint: 'Edited by a user — supersedes the Apollo value.',
  };
  // An overridden field leaves the External Intelligence block: it is now
  // internal data and must say so (never mixed, per the account-view contract).
  const externalField = (
    fieldKey: 'industry' | 'employeeCount' | 'annualRevenueMicros',
    hasValue: boolean,
  ) =>
    overriddenKeys.has(fieldKey)
      ? { ...overrideSource, block: 'internal' as const, overridden: true, fieldKey }
      : { ...fieldSource(hasValue), block: 'external' as const, fieldKey };

  // Win/loss + revenue: prefer the exact Postgres aggregate the production
  // callers pass (account-scoped, uncapped, BigInt-safe). Fall back to deriving
  // from the passed opportunities for unit tests / pure use — that path is
  // take-capped, so it is NOT used on the live cockpit.
  const { winLoss, revenueEvolution } = performance ?? deriveAccountPerformance(companyOpps);
  const wonDeals = winLoss.wonCount;
  const lostDeals = winLoss.lostCount;

  return {
    company,
    externalLastSyncedAt: apolloLastSyncedAt,
    revenueEvolution,
    winLoss,
    kpis: [
      {
        label: 'Industry',
        value: company.industry ? titleCase(company.industry) : 'Not verified',
        detail: company.industry ? 'company profile' : 'connect Apollo to verify',
        tone: 'blue',
        ...externalField('industry', Boolean(company.industry)),
      },
      {
        label: 'Employees',
        value: company.employeeCount
          ? `${company.employeeCount.toLocaleString()}+`
          : 'Not verified',
        detail: company.employeeCount ? 'company headcount' : 'connect Apollo to verify',
        tone: company.employeeCount ? 'jade' : 'amber',
        ...externalField('employeeCount', Boolean(company.employeeCount)),
      },
      {
        label: 'Annual revenue',
        value: annualRevenue,
        detail: company.annualRevenueMicros ? 'company revenue' : 'connect Apollo to verify',
        tone: company.annualRevenueMicros ? 'purple' : 'amber',
        ...externalField('annualRevenueMicros', Boolean(company.annualRevenueMicros)),
      },
      {
        label: 'External sync',
        value:
          apolloIntel?.freshness === 'fresh'
            ? 'Fresh'
            : apolloIntel?.freshness === 'stale'
              ? 'Stale'
              : 'Not synced',
        detail: apolloIntel ? apolloIntel.creditPolicy.replace('_', ' ') : 'connect in Settings',
        tone: apolloIntel?.freshness === 'fresh' ? 'jade' : 'amber',
        ...(apolloIntel ? apolloSource : missingApolloSource),
        block: 'external' as const,
      },
      {
        label: 'Projects',
        value: companyOpps.length.toString(),
        detail: 'active and historical',
        tone: 'blue',
        ...internalSource,
        block: 'internal' as const,
      },
      {
        label: 'Open deals',
        value: openDeals.length.toString(),
        detail: 'opportunity pipeline',
        tone: 'amber',
        ...internalSource,
        block: 'internal' as const,
      },
      // Won/Lost rides the WIN_LOSS_DATA_AVAILABLE flag: hidden entirely when
      // the source system cannot back it — never an empty placeholder.
      ...(winLossAvailable
        ? [
            {
              label: 'Won / Lost',
              value: `${wonDeals} / ${lostDeals}`,
              detail: 'closed outcomes',
              tone: 'teal' as const,
              ...internalSource,
              block: 'internal' as const,
            },
          ]
        : []),
    ],
    technicalStack: resolveCockpitTechnicalStack(company.technicalStack ?? [], fieldOverrides),
    // Score on THIS company's contacts/tasks only. The org-wide dashboard path
    // passes every org row; the single-company path passes pre-filtered rows —
    // scoping here keeps the score identical across both entry points.
    health: computeSignalCoverage({
      company,
      contacts: contacts.filter((c) => c.customer === company.name),
      openDeals,
      tasks: tasks.filter((t) => t.opportunity?.customer === company.name),
    }),
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
