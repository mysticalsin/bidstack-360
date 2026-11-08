/**
 * crm.base.ts — Base attribution and company enrichment schemas for Polo PreSales CRM.
 *
 * Leaf file — no internal imports.
 * Extracted from crm.ts (BS-R1 file-size refactor).
 * Import via @bidstack/shared (re-exported from crm.ts barrel).
 */
import { z } from 'zod';

export const CrmObjectSource = z.enum(['external_crm', 'bidstack', 'dust', 'verified_data']);
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

/** What a public source showed for one technology: the URL or record and when. */
export const TechnicalStackEvidence = z.object({
  url: z.string().url().nullable(),
  record: z.string().max(500).nullable(),
  observedAt: z.string().datetime(),
});
export type TechnicalStackEvidence = z.infer<typeof TechnicalStackEvidence>;

export const TechnicalStackItem = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: TechnicalStackEvidence.optional(),
  /** Demo fixture, shown with a Sample tag. */
  sample: z.boolean().optional(),
});
export type TechnicalStackItemType = z.infer<typeof TechnicalStackItem>;

export const TechnicalStackCategory = z.object({
  /** Named stack for companies that run more than one (a business unit, region or entity). Absent means the main stack. */
  stack: z.string().max(80).optional(),
  label: z.string().min(1),
  items: z.array(TechnicalStackItem),
});
export type TechnicalStackCategory = z.infer<typeof TechnicalStackCategory>;

export const TechnicalStackSuggestion = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  item: TechnicalStackItem,
  providerUpdatedAt: z.string().datetime().nullable(),
});
export type TechnicalStackSuggestion = z.infer<typeof TechnicalStackSuggestion>;

/** Open data lanes: DNS records, certificate transparency, homepage, job postings, GitHub. */
export const OpenTechLane = z.enum(['dns', 'ct', 'web', 'jobs', 'github']);
export type OpenTechLane = z.infer<typeof OpenTechLane>;

/** What one open data lane found on its last run. */
export const TechnicalStackCoverageLane = z.object({
  lane: OpenTechLane,
  status: z.enum(['found', 'empty', 'failed', 'skipped']),
  count: z.number().int().min(0),
  detail: z.string().max(300).nullable(),
  checkedAt: z.string().datetime().nullable(),
});
export type TechnicalStackCoverageLane = z.infer<typeof TechnicalStackCoverageLane>;

export const TechnicalStackCoverage = z.object({
  checkedAt: z.string().datetime().nullable(),
  lanes: z.array(TechnicalStackCoverageLane),
  openItems: z.number().int().min(0),
  /** Apollo is a fallback: queued only when open lanes find fewer than the threshold. */
  apolloFallback: z.enum(['queued', 'not_needed', 'not_configured', 'unavailable']).nullable(),
  apolloThreshold: z.number().int().min(0),
  sample: z.boolean(),
});
export type TechnicalStackCoverage = z.infer<typeof TechnicalStackCoverage>;

export const TechnicalStackState = z.object({
  companyKey: z.string().min(1),
  manualStack: z.array(TechnicalStackCategory),
  providerStack: z.array(TechnicalStackCategory),
  effectiveStack: z.array(TechnicalStackCategory),
  suggestions: z.array(TechnicalStackSuggestion),
  updatedAt: z.string().datetime().nullable(),
  coverage: TechnicalStackCoverage.nullable().optional(),
});
export type TechnicalStackState = z.infer<typeof TechnicalStackState>;

export const TechnicalStackRefreshProvider = z.object({
  id: z.enum(['apollo', 'seamless', 'tech_intel', 'open_data']),
  label: z.string().min(1),
  status: z.enum(['synced', 'queued', 'disabled', 'unavailable', 'skipped']),
  transport: z.enum(['mcp', 'api', 'open_data', 'queue']).nullable(),
  message: z.string().min(1),
  lastCheckedAt: z.string().datetime(),
  /** Open data only: per lane counts from this run. */
  lanes: z.array(TechnicalStackCoverageLane).optional(),
});
export type TechnicalStackRefreshProvider = z.infer<typeof TechnicalStackRefreshProvider>;

export const TechnicalStackRefreshResponse = z.object({
  state: TechnicalStackState,
  providers: z.array(TechnicalStackRefreshProvider),
});
export type TechnicalStackRefreshResponse = z.infer<typeof TechnicalStackRefreshResponse>;
