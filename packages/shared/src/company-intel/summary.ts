/**
 * Company intel summary (slice 14): the compact, list-level view of where an
 * account is heading. One row per company, recomputed by the worker after
 * every intel or enrichment run and read by the Companies list and the
 * company header.
 *
 * Every number carries its source, as-of date and method. Numbers Polo
 * derives (growth rates, the direction badge, approximate USD) are marked
 * inferred. Empty values carry the reason they are empty.
 */
import { z } from 'zod';

import { FUNCTION_LABEL, summarizeHiring, type HiringPostingInput } from './hiring.js';
import { POST_KIND_LABEL } from './posts.js';
import { FINANCIAL_SOURCE_LABEL, IntelPostKind } from './types.js';

const Iso = z.string();

/** Why a value is empty. */
export const IntelEmptyReason = z.enum(['not_connected', 'private_company', 'no_public_data']);
/** Why a value is empty. */
export type IntelEmptyReason = z.infer<typeof IntelEmptyReason>;

/** Short label per empty reason. */
export const INTEL_EMPTY_REASON_LABEL: Record<IntelEmptyReason, string> = {
  not_connected: 'Not connected',
  private_company: 'Private company',
  no_public_data: 'No public data',
};

/** One number with where it came from. */
export const IntelMetric = z.object({
  value: z.number(),
  source: z.string(),
  sourceLabel: z.string(),
  asOf: Iso.nullable(),
  method: z.string(),
  inferred: z.boolean(),
  sample: z.boolean(),
});
/** One number with where it came from. */
export type IntelMetric = z.infer<typeof IntelMetric>;

/** An empty value and why. */
export const IntelGap = z.object({ reason: IntelEmptyReason, detail: z.string() });
/** An empty value and why. */
export type IntelGap = z.infer<typeof IntelGap>;

/** Direction badge values. */
export const IntelDirection = z.enum(['growing', 'steady', 'contracting']);
/** Direction badge values. */
export type IntelDirection = z.infer<typeof IntelDirection>;

/** Fields that can be empty with a reason. */
export const INTEL_SUMMARY_FIELDS = [
  'revenue',
  'revenueGrowth',
  'headcount',
  'headcountGrowth',
  'openRoles',
  'newRoles30d',
  'hiringTrend',
  'funding',
  'signal',
  'direction',
] as const;
/** A field that can be empty with a reason. */
export type IntelSummaryField = (typeof INTEL_SUMMARY_FIELDS)[number];

/** GET /companies list item `intel`, GET /companies/:id/intel/summary. */
export const CompanyIntelSummary = z.object({
  companyId: z.string(),
  computedAt: Iso,
  revenue: IntelMetric.extend({
    currency: z.string().nullable(),
    fiscalYear: z.number().nullable(),
    range: z.string().nullable(),
    approxUsd: z.number().nullable(),
  }).nullable(),
  revenueGrowth: IntelMetric.extend({ fromYear: z.number(), toYear: z.number() }).nullable(),
  headcount: IntelMetric.nullable(),
  headcountGrowth: IntelMetric.extend({ window: z.enum(['6m', '12m']) }).nullable(),
  openRoles: IntelMetric.nullable(),
  newRoles30d: IntelMetric.extend({
    prev30: z.number(),
    trend30Pct: z.number().nullable(),
    trend90Pct: z.number().nullable(),
  }).nullable(),
  hiringTrend: z
    .object({ monthly: z.array(z.number()), source: z.string(), sourceLabel: z.string(), asOf: Iso.nullable(), sample: z.boolean() })
    .nullable(),
  hiringMix: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })),
  topSkills: z.array(z.string()),
  funding: IntelMetric.extend({ latestRound: z.string().nullable(), latestRoundAt: Iso.nullable() }).nullable(),
  foundedYear: z.number().nullable(),
  industry: z.string().nullable(),
  technologies: z.array(z.string()),
  departmentHeadcount: z.array(z.object({ key: z.string(), count: z.number() })),
  signal: z
    .object({
      kind: IntelPostKind,
      label: z.string(),
      title: z.string(),
      url: z.string().nullable(),
      publishedAt: Iso.nullable(),
      sourceLabel: z.string(),
      sample: z.boolean(),
    })
    .nullable(),
  direction: z
    .object({ value: IntelDirection, reasons: z.array(z.string()), inferred: z.literal(true) })
    .nullable(),
  gaps: z.record(z.string(), IntelGap),
  sample: z.boolean(),
});
/** Company intel summary. */
export type CompanyIntelSummary = z.infer<typeof CompanyIntelSummary>;

/** One filed or registry fiscal year as the summary reads it. */
export interface IntelSummaryYear {
  fiscalYear: number;
  periodEnd: string;
  currency: string | null;
  /** Period source key: sec_edgar, esef, brreg, fr_rne, manual_import, fixture. */
  source: string;
  revenue: number | null;
  headcount: number | null;
  fetchedAt: string | null;
}

/** Apollo (or other provider) organization fields as stored. */
export interface IntelSummaryFirmographics {
  annualRevenueUsd: number | null;
  revenueRange: string | null;
  employeeCount: number | null;
  /** Fractions as the provider returns them (0.04 = 4%). */
  headcountGrowth6m: number | null;
  headcountGrowth12m: number | null;
  totalFundingUsd: number | null;
  latestFundingStage: string | null;
  latestFundingAt: string | null;
  foundedYear: number | null;
  industry: string | null;
  techStack: string[];
  departmentHeadcount: Record<string, number> | null;
  provenance: Record<string, { source?: string; fetchedAt?: string } | undefined>;
  fetchedAt: string | null;
}

/** A stored posting plus its sample flag and fetch time. */
export interface IntelSummaryPosting extends HiringPostingInput {
  sample: boolean;
  fetchedAt: string | null;
}

/** A company post or news item. */
export interface IntelSummaryPost {
  kind: IntelPostKind;
  title: string;
  url: string | null;
  publishedAt: string | null;
  sourceLabel: string;
  sample: boolean;
}

/** Last run per public source. */
export type IntelSummaryRuns = Partial<Record<'hiring' | 'posts' | 'financials' | 'registry', { status: string; lastFetchedAt: string | null }>>;

/** Everything the summary is built from. */
export interface IntelSummaryInput {
  companyId: string;
  now: Date;
  years: IntelSummaryYear[];
  postings: IntelSummaryPosting[];
  posts: IntelSummaryPost[];
  firmographics: IntelSummaryFirmographics | null;
  crm: { employeeCount: number | null; industry: string | null; updatedAt: string | null };
  /** Which sources are configured on the server. */
  connections: { publicSources: boolean; apollo: boolean };
  runs: IntelSummaryRuns;
}

/** Saved views on the Companies list, as server filters. */
export const COMPANY_INTEL_VIEWS = {
  hiring_fast: { label: 'Hiring fast', minNewRoles30d: 5 },
  revenue_over_1b: { label: 'Revenue over 1B', minRevenueUsd: 1_000_000_000 },
  contracting: { label: 'Contracting', direction: 'contracting' as IntelDirection },
} as const;
/** Saved view keys. */
export const CompanyIntelView = z.enum(['hiring_fast', 'revenue_over_1b', 'contracting']);
/** Saved view key. */
export type CompanyIntelView = z.infer<typeof CompanyIntelView>;

/** Approximate USD for filtering and sorting only. Null for unknown currencies. */
export function approxUsd(amount: number, currency: string | null): number | null {
  void amount;
  void currency;
  throw new Error('not implemented');
}

/** Build the summary for one company. */
export function buildIntelSummary(input: IntelSummaryInput): CompanyIntelSummary {
  void input;
  void FUNCTION_LABEL;
  void summarizeHiring;
  void POST_KIND_LABEL;
  void FINANCIAL_SOURCE_LABEL;
  throw new Error('not implemented');
}
