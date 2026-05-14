import { z } from 'zod';

export const CrmObjectSource = z.enum(['twenty', 'bidstack', 'dust', 'enrichment']);
export type CrmObjectSource = z.infer<typeof CrmObjectSource>;

export const SourceAttribution = z.object({
  source: z.string().min(1),
  label: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  fetchedAt: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  providerMetadata: z.record(z.unknown()).default({}),
});
export type SourceAttribution = z.infer<typeof SourceAttribution>;

export const CrmLogoSource = z.enum([
  'official_website',
  'logo_dev',
  'brandfetch',
  'wikimedia',
  'favicon',
  'manual',
  'initials',
]);
export type CrmLogoSource = z.infer<typeof CrmLogoSource>;

export const CrmLogo = z.object({
  url: z.string().url().nullable(),
  source: CrmLogoSource,
  cachedAt: z.string().datetime(),
  attribution: SourceAttribution.nullable(),
});
export type CrmLogo = z.infer<typeof CrmLogo>;

export const TechnicalStackItem = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type TechnicalStackItem = z.infer<typeof TechnicalStackItem>;

export const TechnicalStackCategory = z.object({
  label: z.string().min(1),
  items: z.array(TechnicalStackItem),
});
export type TechnicalStackCategory = z.infer<typeof TechnicalStackCategory>;

export const CrmCompany = z.object({
  id: z.string(),
  source: CrmObjectSource.default('twenty'),
  name: z.string().min(1),
  legalName: z.string().nullable(),
  domain: z.string().nullable(),
  website: z.string().url().nullable(),
  industry: z.string().nullable(),
  imageUrl: z.string().url().nullable().optional(),
  employeeCount: z.number().int().nonnegative().nullable(),
  annualRevenueMicros: z.number().int().nonnegative().nullable(),
  status: z.string().nullable(),
  registryIds: z.record(z.string()).default({}),
  formerNames: z.array(z.string()).default([]),
  incorporationDate: z.string().date().nullable(),
  logo: CrmLogo.nullable(),
  technicalStack: z.array(TechnicalStackCategory).optional(),
  confidence: z.number().min(0).max(1),
  sourceAttribution: z.array(SourceAttribution).default([]),
  updatedAt: z.string().datetime(),
});
export type CrmCompany = z.infer<typeof CrmCompany>;

export const CrmPerson = z.object({
  id: z.string(),
  source: CrmObjectSource.default('twenty'),
  companyId: z.string().nullable(),
  name: z.string().min(1),
  title: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  influence: z.number().int().min(0).max(5).nullable(),
  roleInDecision: z.enum(['buyer', 'blocker', 'champion', 'influencer', 'user']).nullable(),
  updatedAt: z.string().datetime(),
});
export type CrmPerson = z.infer<typeof CrmPerson>;

export const CrmDealStage = z.enum([
  'new',
  'screening',
  'meeting',
  'proposal',
  'customer',
  'closed_won',
  'closed_lost',
]);
export type CrmDealStage = z.infer<typeof CrmDealStage>;

export const CrmDeal = z.object({
  id: z.string(),
  source: CrmObjectSource.default('twenty'),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  name: z.string().min(1),
  stage: CrmDealStage,
  amountMicros: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
  probability: z.number().int().min(0).max(100).nullable(),
  closeDate: z.string().date().nullable(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type CrmDeal = z.infer<typeof CrmDeal>;

export const CrmActivity = z.object({
  id: z.string(),
  source: CrmObjectSource.default('twenty'),
  subject: z.string().min(1),
  body: z.string().nullable(),
  kind: z.enum(['note', 'task', 'call', 'email', 'meeting', 'timeline_event', 'job', 'dust']),
  companyId: z.string().nullable(),
  dealId: z.string().nullable(),
  personId: z.string().nullable(),
  actorName: z.string().nullable(),
  occurredAt: z.string().datetime(),
});
export type CrmActivity = z.infer<typeof CrmActivity>;

export const AiInsightKind = z.enum([
  'account_brief',
  'deal_stagnation',
  'funding_upsell',
  'pipeline_velocity',
  'win_loss_cluster',
  'proposal_readiness',
  'bid_no_bid',
  'account_risk',
  'next_best_action',
]);
export type AiInsightKind = z.infer<typeof AiInsightKind>;

export const AiInsight = z.object({
  id: z.string(),
  kind: AiInsightKind,
  title: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  companyId: z.string().nullable(),
  companyName: z.string().nullable(),
  dealId: z.string().nullable(),
  sourceAttribution: z.array(SourceAttribution),
  createdAt: z.string().datetime(),
});
export type AiInsight = z.infer<typeof AiInsight>;

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

export const CompanyHealth = z.object({
  score: z.number().int().min(0).max(100),
  band: HealthBand,
  counts: z.record(z.number().int().nonnegative()),
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

export const SalesMetricKpi = z.object({
  id: z.enum(['quotations', 'orders', 'revenue', 'average_order']),
  label: z.string().min(1),
  kind: z.enum(['count', 'money']),
  value: z.number().nonnegative(),
  currencyCode: z.string().length(3).nullable(),
  percentChange: z.number(),
  trend: z.enum(['up', 'down', 'flat']),
  tone: z.enum(['blue', 'jade', 'amber', 'purple']),
});
export type SalesMetricKpi = z.infer<typeof SalesMetricKpi>;

export const MonthlySalesPoint = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  label: z.string().min(1),
  revenueMicros: z.number().int().nonnegative(),
  quotationCount: z.number().int().nonnegative(),
  orderCount: z.number().int().nonnegative(),
});
export type MonthlySalesPoint = z.infer<typeof MonthlySalesPoint>;

export const SalesRankRow = z.object({
  id: z.string().min(1),
  number: z.string().nullable(),
  customer: z.string().min(1),
  salesperson: z.string().nullable(),
  revenueMicros: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
  countryCode: z.string().length(2).nullable(),
  state: z.string().min(1),
  date: z.string().datetime().nullable(),
});
export type SalesRankRow = z.infer<typeof SalesRankRow>;

export const CountrySalesPerson = z.object({
  name: z.string().min(1),
  title: z.string().nullable(),
  email: z.string().email().nullable(),
  customer: z.string().min(1),
});
export type CountrySalesPerson = z.infer<typeof CountrySalesPerson>;

export const CountrySalesRow = z.object({
  countryCode: z.string().length(2),
  countryName: z.string().min(1),
  revenueMicros: z.number().int().nonnegative(),
  quotationCount: z.number().int().nonnegative(),
  orderCount: z.number().int().nonnegative(),
  customerCount: z.number().int().nonnegative(),
  topCustomers: z.array(z.string().min(1)),
  people: z.array(CountrySalesPerson),
  salespeople: z.array(z.string().min(1)),
  sharePct: z.number().min(0).max(100),
});
export type CountrySalesRow = z.infer<typeof CountrySalesRow>;

export const ProductSalesRow = z.object({
  product: z.string().min(1),
  category: z.string().min(1),
  orderCount: z.number().int().nonnegative(),
  revenueMicros: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
});
export type ProductSalesRow = z.infer<typeof ProductSalesRow>;

export const CategorySalesRow = z.object({
  category: z.string().min(1),
  orderCount: z.number().int().nonnegative(),
  revenueMicros: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
  sharePct: z.number().min(0).max(100),
});
export type CategorySalesRow = z.infer<typeof CategorySalesRow>;

export const SalesIntelligenceReport = z.object({
  generatedAt: z.string().datetime(),
  currencyCode: z.string().length(3),
  source: z.enum(['sales_orders', 'opportunities']),
  sourceAttribution: z.array(SourceAttribution),
  kpis: z.array(SalesMetricKpi),
  monthlySales: z.array(MonthlySalesPoint),
  topQuotations: z.array(SalesRankRow),
  topOrders: z.array(SalesRankRow),
  topCountries: z.array(CountrySalesRow),
  topProducts: z.array(ProductSalesRow),
  topCategories: z.array(CategorySalesRow),
});
export type SalesIntelligenceReport = z.infer<typeof SalesIntelligenceReport>;

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

export const AccountCockpitSnapshot = z.object({
  company: CrmCompany,
  kpis: z.array(
    z.object({
      label: z.string().min(1),
      value: z.string().min(1),
      detail: z.string().nullable(),
      tone: z.enum(['blue', 'jade', 'purple', 'amber', 'teal', 'rose']),
    }),
  ),
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
    'stale_enrichment',
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
