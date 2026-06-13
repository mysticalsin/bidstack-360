/**
 * crm.dashboard.ts — Dashboard, cockpit, connectors, and composite response schemas.
 *
 * Extracted from crm.ts (BS-R1 file-size refactor).
 * Import via @bidstack/shared (re-exported from crm.ts barrel).
 */
import { z } from 'zod';
import { SourceAttribution, TechnicalStackCategory } from './crm.base.js';
import { CrmCompany, CrmPerson, CrmDeal, CrmActivity, AiInsight } from './crm.entities.js';

export const DashboardWidgetKind = z.enum([
  'pipeline_funnel',
  'revenue_forecast',
  'company_grid',
  'ai_insights_feed',
  'activity_timeline',
  'bid_calendar',
  'provider_health',
  'release_score',
]);
export type DashboardWidgetKind = z.infer<typeof DashboardWidgetKind>;

export const DashboardWidget = z.object({
  id: z.string(),
  kind: DashboardWidgetKind,
  title: z.string().min(1),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  config: z.record(z.unknown()).default({}),
});
export type DashboardWidget = z.infer<typeof DashboardWidget>;

export const HealthBand = z.enum(['strong', 'good', 'needs_attention', 'critical']);
export type HealthBand = z.infer<typeof HealthBand>;

// One contributing factor of the Signal Coverage score. A bare 0-100 number
// is useless to a manager — every factor says what it measures and what to do.
export const SignalFactor = z.object({
  key: z.enum(['firmographics', 'contacts', 'engagement', 'pipeline']),
  label: z.string().min(1),
  whatItMeasures: z.string().min(1),
  recommendedAction: z.string().min(1),
  score: z.number().int().min(0).max(100),
  band: HealthBand,
});
export type SignalFactor = z.infer<typeof SignalFactor>;

export const CompanyHealth = z.object({
  score: z.number().int().min(0).max(100),
  band: HealthBand,
  counts: z.record(z.number().int().nonnegative()),
  // Optional for wire-compat with snapshots persisted before factors shipped.
  factors: z.array(SignalFactor).optional(),
});
export type CompanyHealth = z.infer<typeof CompanyHealth>;

export const RiskItem = z.object({
  id: z.string(),
  title: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  owner: z.string().nullable(),
  mitigation: z.string().nullable(),
  dueDate: z.string().date().nullable(),
  status: z.enum(['open', 'in_progress', 'mitigated', 'accepted']),
});
export type RiskItem = z.infer<typeof RiskItem>;

export const ComplianceCheck = z.object({
  id: z.string(),
  label: z.string().min(1),
  status: z.enum(['compliant', 'in_progress', 'blocked', 'not_started']),
  owner: z.string().nullable(),
  sourceAttribution: z.array(SourceAttribution).default([]),
});
export type ComplianceCheck = z.infer<typeof ComplianceCheck>;

export const RoadmapItem = z.object({
  id: z.string(),
  quarter: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['planned', 'in_progress', 'at_risk', 'done']),
});
export type RoadmapItem = z.infer<typeof RoadmapItem>;

export const BidOpportunity = z.object({
  id: z.string(),
  source: z.string().min(1),
  externalId: z.string().min(1),
  title: z.string().min(1),
  buyer: z.string().nullable(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  status: z.string().min(1),
  dueDate: z.string().datetime().nullable(),
  estimatedValueMicros: z.number().int().nonnegative().nullable(),
  currencyCode: z.string().length(3).nullable(),
  url: z.string().url().nullable(),
  recommendation: z.enum(['bid', 'review', 'no_bid']).nullable(),
  readinessScore: z.number().int().min(0).max(100).nullable(),
  sourceAttribution: z.array(SourceAttribution),
});
export type BidOpportunity = z.infer<typeof BidOpportunity>;

export const ProviderStatus = z.enum(['healthy', 'degraded', 'disabled', 'down']);
export type ProviderStatus = z.infer<typeof ProviderStatus>;

export const ProviderHealth = z.object({
  provider: z.string().min(1),
  status: ProviderStatus,
  latencyMs: z.number().int().nonnegative().nullable(),
  lastCheckedAt: z.string().datetime(),
  message: z.string().nullable(),
});
export type ProviderHealth = z.infer<typeof ProviderHealth>;

export const ConnectorKind = z.enum([
  'open_api',
  'credentialed_api',
  'official_widget',
  'licensed_feed',
]);
export type ConnectorKind = z.infer<typeof ConnectorKind>;

export const CrmConnector = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['company', 'market', 'procurement', 'logo', 'people', 'ai']),
  kind: ConnectorKind,
  status: ProviderStatus,
  requiresCredential: z.boolean(),
  sourceUrl: z.string().url(),
  docsUrl: z.string().url(),
  lastCheckedAt: z.string().datetime(),
  message: z.string().nullable(),
  capabilities: z.array(z.string().min(1)),
});
export type CrmConnector = z.infer<typeof CrmConnector>;

export const OpenDataSignal = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  url: z.string().url().nullable(),
  observedAt: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  sourceAttribution: z.array(SourceAttribution).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type OpenDataSignal = z.infer<typeof OpenDataSignal>;

export const OpenDataSignalsResponse = z.object({
  generatedAt: z.string().datetime(),
  connectors: z.array(CrmConnector),
  signals: z.array(OpenDataSignal),
});
export type OpenDataSignalsResponse = z.infer<typeof OpenDataSignalsResponse>;

export const QueueHealth = z.object({
  queueName: z.string().min(1),
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  lastCheckedAt: z.string().datetime(),
});
export type QueueHealth = z.infer<typeof QueueHealth>;

export const ReleaseScore = z.object({
  functional: z.number().int().min(0).max(25),
  code: z.number().int().min(0).max(25),
  design: z.number().int().min(0).max(25),
  infra: z.number().int().min(0).max(25),
  total: z.number().int().min(0).max(100),
  passed: z.boolean(),
  scoredAt: z.string().datetime(),
});
export type ReleaseScore = z.infer<typeof ReleaseScore>;

export const CockpitKpi = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  detail: z.string().nullable(),
  tone: z.enum(['blue', 'jade', 'purple', 'amber', 'teal', 'rose']),
  sourceLabel: z.string().min(1).optional(),
  sourceState: z.enum(['apollo_fresh', 'apollo_stale', 'verified', 'crm', 'missing']).optional(),
  sourceHint: z.string().min(1).optional(),
  // External Intelligence (Apollo-sourced) vs Internal Data (ABC/OM) — the
  // two blocks are never mixed in the UI. Manually edited fields move to
  // internal and carry overridden=true.
  block: z.enum(['external', 'internal']).optional(),
  overridden: z.boolean().optional(),
  // Set on editable external KPIs so the UI can PUT a field override.
  fieldKey: z.enum(['industry', 'employeeCount', 'annualRevenueMicros']).optional(),
});
export type CockpitKpi = z.infer<typeof CockpitKpi>;

export const AccountCockpitSnapshot = z.object({
  company: CrmCompany,
  kpis: z.array(CockpitKpi),
  // Apollo refresh timestamp for the External Intelligence block header
  // ("Last updated: …" — Apollo refreshes roughly every 2 weeks).
  externalLastSyncedAt: z.string().nullable().optional(),
  // Per-account revenue evolution — won-deal value by close month, derived
  // from the account's own pipeline. The block renders when SHOW_REVENUE_BLOCK
  // is on AND points exist, so an account with no won deals shows nothing
  // rather than an empty chart.
  revenueEvolution: z
    .array(z.object({ period: z.string().min(1), revenueMicros: z.number().int().nonnegative() }))
    .optional(),
  // Won/lost summary derived from the account's own opportunity pipeline.
  winLoss: z
    .object({
      wonCount: z.number().int().nonnegative(),
      lostCount: z.number().int().nonnegative(),
      wonValueMicros: z.number().int().nonnegative(),
      lostValueMicros: z.number().int().nonnegative(),
      winRate: z.number().int().min(0).max(100),
    })
    .optional(),
  technicalStack: z.array(TechnicalStackCategory),
  health: CompanyHealth,
  keyContacts: z.array(CrmPerson),
  recentActivity: z.array(CrmActivity),
  risks: z.array(RiskItem),
  compliance: z.array(ComplianceCheck),
  roadmap: z.array(RoadmapItem),
});
export type AccountCockpitSnapshot = z.infer<typeof AccountCockpitSnapshot>;

export const CrmDashboardSnapshot = z.object({
  generatedAt: z.string().datetime(),
  cockpit: AccountCockpitSnapshot,
  companies: z.array(CrmCompany),
  deals: z.array(CrmDeal),
  activities: z.array(CrmActivity),
  insights: z.array(AiInsight),
  widgets: z.array(DashboardWidget),
  bidOpportunities: z.array(BidOpportunity),
  providerHealth: z.array(ProviderHealth),
  queueHealth: z.array(QueueHealth),
  releaseScore: ReleaseScore,
});
export type CrmDashboardSnapshot = z.infer<typeof CrmDashboardSnapshot>;

export const CompanyLookupMatch = z.enum([
  'exact_domain',
  'registry_id',
  'exact_name',
  'fuzzy_name',
  'none',
]);
export type CompanyLookupMatch = z.infer<typeof CompanyLookupMatch>;

export const CompanyLookupResponse = z.object({
  match: CompanyLookupMatch,
  company: CrmCompany.nullable(),
  alternatives: z.array(CrmCompany),
});
export type CompanyLookupResponse = z.infer<typeof CompanyLookupResponse>;

export const CompanyAutopopulateItem = z.object({
  company: CrmCompany,
  action: z.enum(['enriched', 'cached', 'skipped']),
  reason: z.string().nullable(),
});
export type CompanyAutopopulateItem = z.infer<typeof CompanyAutopopulateItem>;

export const CompanyAutopopulateResponse = z.object({
  generatedAt: z.string().datetime(),
  requested: z.number().int().nonnegative(),
  enriched: z.number().int().nonnegative(),
  cached: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  items: z.array(CompanyAutopopulateItem),
  sourceAttribution: z.array(SourceAttribution).default([]),
  warnings: z.array(z.string()).default([]),
});
export type CompanyAutopopulateResponse = z.infer<typeof CompanyAutopopulateResponse>;

export const DataQualityIssue = z.object({
  id: z.string(),
  kind: z.enum([
    'duplicate_company',
    'stale_data',
    'missing_owner',
    'invalid_domain',
    'missing_logo',
  ]),
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string().min(1),
  detail: z.string().nullable(),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  sourceAttribution: z.array(SourceAttribution).default([]),
});
export type DataQualityIssue = z.infer<typeof DataQualityIssue>;

export const DataQualityReport = z.object({
  generatedAt: z.string().datetime(),
  counts: z.record(z.number().int().nonnegative()),
  issues: z.array(DataQualityIssue),
});
export type DataQualityReport = z.infer<typeof DataQualityReport>;

export const DustCrmToolName = z.enum([
  'crm_search_companies',
  'crm_create_deal',
  'crm_update_deal',
  'crm_enrich_company',
  'crm_list_activities',
  'crm_create_activity',
  'crm_generate_insights',
]);
export type DustCrmToolName = z.infer<typeof DustCrmToolName>;
