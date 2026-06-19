/**
 * crm.base.ts — Base attribution and company enrichment schemas for BidStack CRM.
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

export const TechnicalStackItem = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type TechnicalStackItemType = z.infer<typeof TechnicalStackItem>;

export const TechnicalStackCategory = z.object({
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

export const TechnicalStackState = z.object({
  companyKey: z.string().min(1),
  manualStack: z.array(TechnicalStackCategory),
  providerStack: z.array(TechnicalStackCategory),
  effectiveStack: z.array(TechnicalStackCategory),
  suggestions: z.array(TechnicalStackSuggestion),
  updatedAt: z.string().datetime().nullable(),
});
export type TechnicalStackState = z.infer<typeof TechnicalStackState>;

export const TechnicalStackRefreshProvider = z.object({
  id: z.enum(['apollo', 'seamless', 'tech_intel', 'open_data']),
  label: z.string().min(1),
  status: z.enum(['synced', 'queued', 'disabled', 'unavailable']),
  transport: z.enum(['mcp', 'api', 'open_data', 'queue']).nullable(),
  message: z.string().min(1),
  lastCheckedAt: z.string().datetime(),
});
export type TechnicalStackRefreshProvider = z.infer<typeof TechnicalStackRefreshProvider>;

export const TechnicalStackRefreshResponse = z.object({
  state: TechnicalStackState,
  providers: z.array(TechnicalStackRefreshProvider),
});
export type TechnicalStackRefreshResponse = z.infer<typeof TechnicalStackRefreshResponse>;
