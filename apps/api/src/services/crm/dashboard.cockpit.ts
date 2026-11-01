/**
 * dashboard.cockpit.ts — AccountCockpitSnapshot builder and supporting serializers.
 *
 * WHY a separate module: buildCockpit is the largest pure-transform function in
 * the dashboard pipeline (~162 lines). Isolating it here keeps the query layer
 * thin and makes the cockpit logic independently testable.
 */
import { type z } from 'zod';

import {
  recordedDecisionRole,
  type AccountCockpitSnapshot,
  type AiInsight,
  type BidOpportunity,
  type CompanyHealth,
  type CrmActivity,
  type CrmCompany,
  type CrmDashboardSnapshot,
  type FactStatus,
  formatMicrosAmount,
  type PersonFactView,
  type SignalFactor,
} from '@bidstack/shared';

import {
  asComplianceStatus,
  asRiskSeverity,
  asRiskStatus,
  formatMicrosCompact,
  livePipelineStage,
  normalizeName,
  parseAttribution,
  record,
  titleCase,
} from './dashboard.utils.js';
import {
  TECHNICAL_STACK_FIELD_KEY,
  parseTechnicalStackOverride,
} from './technical-stack.service.js';
import { microsWireFields } from '../../lib/micros-wire.js';

const COCKPIT_RISK_LIMIT = 6;
const COCKPIT_COMPLIANCE_LIMIT = 6;

// ─── Signal coverage (M2) ─────────────────────────────────────────────────────
// Real 4-factor scoring replacing the old hardcoded 72/strong placeholder.
// Each factor carries what it measures and the action a manager should take.

type HealthBandValue = z.infer<typeof SignalFactor>['band'];

function firmographicAction(company: z.infer<typeof CrmCompany>): string {
  const missing: string[] = [];
  if (!company.industry) missing.push('industry');
  if (!company.employeeCount) missing.push('headcount');
  if (!company.annualRevenueMicros) missing.push('revenue');
  if ((company.technicalStack?.length ?? 0) === 0) missing.push('tech stack');
  if (company.strategicIntel?.freshness !== 'fresh') missing.push('external-source freshness');
  if (missing.length === 0) return 'Recorded firmographics are on file.';
  return `Still missing: ${missing.join(', ')}.`;
}

function contactAction(
  contacts: Array<{ influence: number | null; email: string | null }>,
): string {
  if (contacts.length === 0) return 'No stakeholders are linked to this account.';
  const rated = contacts.filter((contact) => contact.influence != null).length;
  const withEmail = contacts.filter((contact) => contact.email).length;
  const ratedLabel =
    rated === 0 ? 'none have an influence rating' : `${rated} have an influence rating`;
  const emailLabel =
    withEmail === contacts.length ? 'all have an email' : `${withEmail} have an email`;
  const countLabel =
    contacts.length === 1 ? '1 linked contact' : `${contacts.length} linked contacts`;
  return `${countLabel}. ${ratedLabel}; ${emailLabel}.`;
}

function engagementAction(recent: number, openCount: number, onTrack: number): string {
  const recentLabel =
    recent === 1 ? '1 task in the last 30 days' : `${recent} tasks in the last 30 days`;
  if (recent === 0 && openCount === 0) {
    return 'No tasks in the last 30 days and no open follow-ups.';
  }
  if (recent === 0) return 'No tasks in the last 30 days.';
  const overdue = openCount - onTrack;
  if (overdue > 0) {
    const overdueLabel =
      overdue === 1
        ? '1 open follow-up is past its due date'
        : `${overdue} open follow-ups are past their due date`;
    return `${recentLabel}. ${overdueLabel}.`;
  }
  return `${recentLabel}. Open follow-ups are inside their due dates.`;
}

function pipelineAction(
  openDeals: Array<{ probability: number; dueDate: Date | null; owner: unknown | null }>,
): string {
  if (openDeals.length === 0) return 'No open deals are linked to this account.';
  const missingProbability = openDeals.filter((deal) => !(deal.probability > 0)).length;
  const missingOwner = openDeals.filter((deal) => deal.owner == null).length;
  const missingDate = openDeals.filter((deal) => deal.dueDate == null).length;
  const countLabel = openDeals.length === 1 ? '1 open deal' : `${openDeals.length} open deals`;
  if (missingProbability === 0 && missingOwner === 0 && missingDate === 0) {
    return `${countLabel} with a probability above 0, an owner, and a close date.`;
  }
  const gaps = [
    missingProbability > 0 ? `${missingProbability} without a probability above 0` : null,
    missingOwner > 0 ? `${missingOwner} without an owner` : null,
    missingDate > 0 ? `${missingDate} without a close date` : null,
  ].filter((gap): gap is string => gap !== null);
  return `${countLabel}. ${gaps.join('; ')}.`;
}

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
    recommendedAction: FACTOR_ACTIONS[key][band === 'strong' || band === 'good' ? 'high' : 'low'],
    score: clamped,
    band,
  };
}

export const COCKPIT_OPP_PAGE = 100;
export const COCKPIT_CONTACT_PAGE = 20;
export const COCKPIT_TASK_PAGE = 50;

export function computeSignalCoverage(
  input: {
    company: z.infer<typeof CrmCompany>;
    contacts: Array<{ influence: number | null; email: string | null }>;
    openDeals: Array<{ probability: number; dueDate: Date | null; owner: unknown | null }>;
    tasks: Array<{ status: string; dueDate: Date | null; createdAt: Date }>;
  },
  pages?: { contactsCapped?: boolean; dealsCapped?: boolean; tasksCapped?: boolean },
): CompanyHealth {
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
    Math.min(50, recent * 17) + (open.length > 0 ? Math.round((onTrack / open.length) * 50) : 0),
  );

  const complete = openDeals.filter(
    (d) => d.probability > 0 && d.dueDate != null && d.owner != null,
  ).length;
  const pipeline = factor(
    'pipeline',
    'Pipeline data quality',
    'Open deals carrying probability, owner, and an expected close date.',
    openDeals.length > 0 ? Math.round((complete / openDeals.length) * 100) : 0,
  );

  firmographics.recommendedAction = firmographicAction(company);
  contactFactor.recommendedAction = contactAction(contacts);
  engagement.recommendedAction = engagementAction(recent, open.length, onTrack);
  pipeline.recommendedAction = pipelineAction(openDeals);
  if (pages?.contactsCapped) {
    contactFactor.whatItMeasures += ` Scored from the ${COCKPIT_CONTACT_PAGE} highest-influence contacts.`;
  }
  if (pages?.dealsCapped) {
    pipeline.whatItMeasures += ` Scored from the latest ${COCKPIT_OPP_PAGE} opportunities.`;
  }
  if (pages?.tasksCapped) {
    engagement.whatItMeasures += ` Scored from the latest ${COCKPIT_TASK_PAGE} tasks.`;
  }

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
    wonValueMicros: string;
    lostValueMicros: string;
    winRate: number | null;
  };
  revenueEvolution: Array<{ period: string; revenueMicros: string }>;
}

/** Integer micros text. Number() moves a sum past 2^53 off the cent. */
export function microsText(value: bigint | number | string | null | undefined): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isFinite(value))
    return BigInt(Math.trunc(value)).toString();
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = BigInt(value);
    return parsed < 0n ? '0' : parsed.toString();
  }
  return '0';
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
    pipelineStage?: { isWon: boolean; isLost: boolean; deletedAt?: Date | null } | null;
  }>,
): AccountPerformance {
  const toMicros = (v: bigint | number | unknown): bigint => {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
    return 0n;
  };
  const lostOpps = opps.filter((o) => {
    const stage = livePipelineStage(o.pipelineStage);
    return stage?.isLost === true || o.stage === 'closed_lost';
  });
  // Lost wins when the enum and a won flag disagree, and when both flags are set.
  const wonOpps = opps.filter((o) => {
    const stage = livePipelineStage(o.pipelineStage);
    return (
      stage?.isLost !== true &&
      o.stage !== 'closed_lost' &&
      (stage?.isWon === true || o.stage === 'closed_won')
    );
  });
  const decided = wonOpps.length + lostOpps.length;

  const revenueByMonth = new Map<string, bigint>();
  for (const o of wonOpps) {
    const when = o.dueDate ?? null;
    if (!when) continue;
    const d = when instanceof Date ? when : new Date(when as string);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0n) + toMicros(o.valueMicros));
  }
  return {
    winLoss: {
      wonCount: wonOpps.length,
      lostCount: lostOpps.length,
      wonValueMicros: wonOpps.reduce((s, o) => s + toMicros(o.valueMicros), 0n).toString(),
      lostValueMicros: lostOpps.reduce((s, o) => s + toMicros(o.valueMicros), 0n).toString(),
      winRate: decided > 0 ? Math.round((wonOpps.length / decided) * 100) : null,
    },
    revenueEvolution: [...revenueByMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([period, revenueMicros]) => ({ period, revenueMicros: revenueMicros.toString() })),
  };
}

// ─── Field overrides (M1) ─────────────────────────────────────────────────────

export interface CockpitFieldOverride {
  fieldKey: string;
  value: unknown;
}

function revenueOverrideMicros(value: unknown): bigint | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  return null;
}

function exactStoredRevenueLabel(company: {
  annualRevenueMicros?: number | null;
  annualRevenueMicrosText?: string | null;
}): string | null {
  const text = company.annualRevenueMicrosText;
  if (!text || !/^\d+$/.test(text)) return null;
  const micros = BigInt(text);
  if (micros <= 0n) return null;
  if (
    company.annualRevenueMicros != null &&
    Number.isSafeInteger(company.annualRevenueMicros) &&
    BigInt(company.annualRevenueMicros) === micros
  ) {
    return null;
  }
  return `${formatMicrosAmount(micros)} unspecified`;
}

/** Exact revenue text from a manual override, when one is stored. */
export function revenueOverrideLabel(overrides: CockpitFieldOverride[]): string | null {
  for (const override of overrides) {
    if (override.fieldKey !== 'annualRevenueMicros') continue;
    const micros = revenueOverrideMicros(override.value);
    if (micros == null || micros <= 0n) continue;
    return `${formatMicrosAmount(micros)} unspecified`;
  }
  return null;
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
    } else if (o.fieldKey === 'annualRevenueMicros') {
      const micros = revenueOverrideMicros(o.value);
      if (micros == null || micros <= 0n) continue;
      overriddenKeys.add('annualRevenueMicros');
      next.annualRevenueMicrosText = micros.toString();
      next.annualRevenueMicros = micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null;
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
  return providerStack;
}

// ─── Activity serializer ──────────────────────────────────────────────────────

export function buildActivities(
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    accountId?: string | null;
    opportunity?: { id: string; customer: string; name: string; companyId: string | null } | null;
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
    companyId: task.opportunity?.companyId ?? task.accountId ?? null,
    dealId: task.opportunity?.id ?? null,
    personId: null,
    actorName: task.assignee?.name ?? task.assignee?.email ?? null,
    occurredAt: task.createdAt.toISOString(),
  }));
}

// ─── Default insights ─────────────────────────────────────────────────────────

type StoredInsightRow = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  confidenceBps: number;
  companyName: string | null;
  opportunityId: string | null;
  sourceAttribution: unknown;
  createdAt: Date;
};

/** Only rows that were stored. An empty list is not a scored stagnation warning. */
export function mapStoredInsights(
  rows: readonly StoredInsightRow[],
  companyIdByOpportunityId: ReadonlyMap<string, string | null> = new Map(),
): Array<z.infer<typeof AiInsight>> {
  return rows.map((insight) => ({
    id: insight.id,
    kind: insight.kind as z.infer<typeof AiInsight>['kind'],
    title: insight.title,
    summary: insight.summary,
    confidence: insight.confidenceBps / 10_000,
    // A stored name is a label. The company id comes from the linked opportunity.
    companyId: insight.opportunityId
      ? (companyIdByOpportunityId.get(insight.opportunityId) ?? null)
      : null,
    companyName: insight.companyName,
    dealId: insight.opportunityId,
    sourceAttribution: parseAttribution(insight.sourceAttribution),
    createdAt: insight.createdAt.toISOString(),
  }));
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
  const value = row.estimatedValueMicros === null ? null : microsWireFields(row.estimatedValueMicros);
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
    estimatedValueMicros: value?.valueMicros ?? null,
    estimatedValueMicrosText: value?.valueMicrosText ?? null,
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
  buyingRoleFacts = [],
  now = new Date(),
  coveragePages,
  openDealCount,
  openRiskCount,
  openComplianceCount,
  risksCapped,
  complianceCapped,
  buyingRolesCapped = false,
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
    companyId: string | null;
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
    owner: { name: string | null; email: string } | null;
  }>;
  contacts: Array<{
    id: string;
    customer: string;
    companyId: string | null;
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
    accountId?: string | null;
    opportunity: { customer: string; companyId: string | null; id: string; name: string } | null;
    assignee: { name: string | null; email: string } | null;
    createdAt: Date;
  }>;
  risks: Array<{
    id: string;
    opportunityId: string | null;
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
    opportunityId: string | null;
    label: string;
    status: string;
    owner: string | null;
    sourceAttribution: unknown;
  }>;
  /** Accepted or not, the builder keeps only one fresh accepted role. */
  buyingRoleFacts?: Array<{
    contactId: string;
    status: string;
    linkLabel: string | null;
    opportunityId: string | null;
    observedAt: Date | null;
  }>;
  now?: Date;
  /** Set when a cockpit list filled its page, so coverage is not the whole account. */
  coveragePages?: { contactsCapped?: boolean; dealsCapped?: boolean; tasksCapped?: boolean };
  /** Exact open-deal count when the opportunity page is not the whole book. */
  openDealCount?: number;
  openRiskCount?: number;
  openComplianceCount?: number;
  risksCapped?: boolean;
  complianceCapped?: boolean;
  /** Accepted buying-role facts filled their page, so one role is not the whole set. */
  buyingRolesCapped?: boolean;
}): z.infer<typeof AccountCockpitSnapshot> {
  const { company, overriddenKeys } = applyFieldOverrides(rawCompany, fieldOverrides);
  const companyOpps = opportunities.filter((opp) => opp.companyId === company.id);
  const accountTasks = tasks.filter(
    (task) => task.accountId === company.id || task.opportunity?.companyId === company.id,
  );
  const openDeals = companyOpps.filter((opp) => {
    const stage = livePipelineStage(opp.pipelineStage);
    return (
      !stage?.isWon &&
      !stage?.isLost &&
      opp.stage !== 'customer' &&
      opp.stage !== 'closed_won' &&
      opp.stage !== 'closed_lost'
    );
  });
  const accountContacts = contacts
    .filter((contact) => contact.companyId === company.id)
    .slice()
    .sort((a, b) => {
      const influenceDelta = (b.influence ?? -1) - (a.influence ?? -1);
      if (influenceDelta !== 0) return influenceDelta;
      return a.name.localeCompare(b.name);
    });
  const storedRevenueText = exactStoredRevenueLabel(company);
  const annualRevenue =
    revenueOverrideLabel(fieldOverrides) ??
    storedRevenueText ??
    (company.annualRevenueMicros
      ? formatMicrosCompact(company.annualRevenueMicros)
      : (company.publicFacts?.revenueLabel ?? 'Not verified'));
  const accountOpportunityIds = new Set(companyOpps.map((opp) => opp.id));
  const roleDealIds = new Set(accountOpportunityIds);
  for (const fact of buyingRoleFacts) {
    if (fact.opportunityId) roleDealIds.add(fact.opportunityId);
  }
  const companyRisks = risks.filter(
    (risk) => risk.opportunityId != null && accountOpportunityIds.has(risk.opportunityId),
  );
  const visibleRisks = uniqueBy(companyRisks, riskKey).slice(0, COCKPIT_RISK_LIMIT);
  const companyCompliance = compliance.filter(
    (check) => check.opportunityId != null && accountOpportunityIds.has(check.opportunityId),
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
        : 'Polo PreSales CRM pipeline record',
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
    sourceHint: 'Computed from Polo PreSales opportunities.',
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
        detail: company.industry
          ? 'recorded industry on this account'
          : 'not recorded on this account',
        tone: 'blue',
        ...externalField('industry', Boolean(company.industry)),
      },
      {
        label: 'Employees',
        value: company.employeeCount
          ? `${company.employeeCount.toLocaleString()}+`
          : 'Not verified',
        detail: company.employeeCount
          ? 'recorded headcount on this account, not a live census'
          : 'not recorded on this account',
        tone: company.employeeCount ? 'jade' : 'amber',
        ...externalField('employeeCount', Boolean(company.employeeCount)),
      },
      {
        label: 'Annual revenue',
        value: annualRevenue,
        detail: company.annualRevenueMicros
          ? 'currency not recorded; not a euro forecast'
          : 'not recorded on this account',
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
        detail: apolloIntel
          ? 'stored sync freshness on this account, not a live probe'
          : 'not synced',
        tone: apolloIntel?.freshness === 'fresh' ? 'jade' : 'amber',
        ...(apolloIntel ? apolloSource : missingApolloSource),
        block: 'external' as const,
      },
      {
        label: 'Projects',
        value: companyOpps.length.toString(),
        detail: 'count of opportunities matched to this account',
        tone: 'blue',
        ...internalSource,
        block: 'internal' as const,
      },
      {
        label: 'Open deals',
        value: (openDealCount ?? openDeals.length).toString(),
        detail: 'count of open opportunities on this account',
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
              detail: 'count of recorded closed outcomes on this account',
              tone: 'teal' as const,
              ...internalSource,
              block: 'internal' as const,
            },
          ]
        : []),
    ],
    technicalStack: resolveCockpitTechnicalStack(company.technicalStack ?? [], fieldOverrides),
    // Score on THIS company's contacts/tasks only. A matching customer string
    // is not a link: historical rows keep companyId null until someone confirms
    // them, and a contact linked to another company must not land here.
    health: computeSignalCoverage({
      company,
      contacts: accountContacts,
      openDeals,
      tasks: accountTasks,
    }, coveragePages),
    keyContacts: accountContacts.slice(0, 5).map((contact) => ({
      id: contact.id,
      source: 'external_crm',
      companyId: contact.companyId,
      name: contact.name,
      title: contact.role,
      email: contact.email,
      phone: contact.phone,
      influence: contact.influence,
      // A job title stays in `title`. Only one fresh accepted buying role
      // on a deal for this account fills the station.
      roleInDecision: buyingRolesCapped
        ? null
        : recordedDecisionRole(
        buyingRoleFacts
          .filter((fact) => fact.contactId === contact.id)
          .map(buyingRoleFactView)
          .filter((fact): fact is PersonFactView => fact !== null),
        now,
        roleDealIds,
      ),
      updatedAt: contact.createdAt.toISOString(),
    })),
    recentActivity: buildActivities(accountTasks).slice(0, 5),
    risks: visibleRisks.map(serializeRisk),
    compliance: visibleCompliance.map(serializeCompliance),
    openRiskCount,
    openComplianceCount,
    risksCapped,
    complianceCapped,
    buyingRolesCapped,
    roadmap: [],
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

const FACT_STATUSES = new Set<FactStatus>(['proposed', 'accepted', 'dismissed', 'needs_review']);

function buyingRoleFactView(fact: {
  status: string;
  linkLabel: string | null;
  opportunityId: string | null;
  observedAt: Date | null;
}): PersonFactView | null {
  if (!FACT_STATUSES.has(fact.status as FactStatus)) return null;
  return {
    id: 'buying-role',
    kind: 'buying_role',
    status: fact.status as FactStatus,
    reportsToContactId: null,
    opportunityId: fact.opportunityId,
    companyId: null,
    linkLabel: fact.linkLabel,
    observedAt: fact.observedAt ? fact.observedAt.toISOString() : null,
  };
}
