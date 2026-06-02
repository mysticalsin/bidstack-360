/**
 * crm.entities.ts — Core CRM domain entities: Company, Person, Deal, Activity, AI Insight.
 *
 * Extracted from crm.ts (BS-R1 file-size refactor).
 * Import via @bidstack/shared (re-exported from crm.ts barrel).
 */
import { z } from 'zod';
import { CrmObjectSource, SourceAttribution, CrmLogo, TechnicalStackCategory } from './crm.base.js';

export const CompanyStrategicSignalKind = z.enum([
  'intent',
  'hiring',
  'headcount',
  'revenue',
  'funding',
  'leadership',
  'technology',
  'news',
  'risk',
  'other',
]);
export type CompanyStrategicSignalKind = z.infer<typeof CompanyStrategicSignalKind>;

export const CompanyStrategicSignal = z.object({
  id: z.string().min(1),
  kind: CompanyStrategicSignalKind,
  label: z.string().min(1),
  detail: z.string().nullable(),
  observedAt: z.string().datetime(),
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
  url: z.string().url().nullable(),
  metadata: z.record(z.unknown()).default({}),
});
export type CompanyStrategicSignal = z.infer<typeof CompanyStrategicSignal>;

export const CompanyStrategicIntel = z.object({
  provider: z.string().min(1),
  lastSyncedAt: z.string().datetime().nullable(),
  syncMode: z.enum([
    'apollo_mcp_company_search',
    'apollo_mcp_get_company',
    'apollo_api_organization_enrich',
    'open_data',
    'none',
  ]),
  creditPolicy: z.enum(['free_search', 'uses_credits', 'mixed', 'unknown']),
  freshness: z.enum(['fresh', 'stale', 'never']),
  employeeTrend: z.enum(['hiring', 'contracting', 'flat', 'unknown']),
  employeeCount: z.number().int().nonnegative().nullable(),
  annualRevenueMicros: z.number().int().nonnegative().nullable(),
  intentTopics: z.array(z.string()).default([]),
  hiringSignals: z.array(CompanyStrategicSignal).default([]),
  leadershipSignals: z.array(CompanyStrategicSignal).default([]),
  revenueSignals: z.array(CompanyStrategicSignal).default([]),
  summary: z.string().min(1),
  limitations: z.array(z.string()).default([]),
  signals: z.array(CompanyStrategicSignal).default([]),
});
export type CompanyStrategicIntel = z.infer<typeof CompanyStrategicIntel>;

export const CrmCompany = z.object({
  id: z.string(),
  source: CrmObjectSource.default('external_crm'),
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
  strategicIntel: CompanyStrategicIntel.optional(),
  confidence: z.number().min(0).max(1),
  sourceAttribution: z.array(SourceAttribution).default([]),
  updatedAt: z.string().datetime(),
});
export type CrmCompany = z.infer<typeof CrmCompany>;

export const CrmPerson = z.object({
  id: z.string(),
  source: CrmObjectSource.default('external_crm'),
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
  source: CrmObjectSource.default('external_crm'),
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
  source: CrmObjectSource.default('external_crm'),
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
