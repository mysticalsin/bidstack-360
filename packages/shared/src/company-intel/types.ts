/**
 * Account intelligence contracts (slice 12): hiring, company posts,
 * financials, investment themes and the cross-referenced direction view.
 *
 * Evidence ledger rule: every fact carries the URL it came from, the time it
 * was fetched and the excerpt it was read from. Derived lines cite the
 * evidence ids they were built from and carry basis `inferred`.
 */
import { z } from 'zod';

import { InitiativeTheme } from '../schemas/account-signals.js';

const Iso = z.string();

/** Sources the account page can refresh one at a time. */
export const IntelSourceKey = z.enum(['hiring', 'posts', 'financials', 'registry']);
/** Sources the account page can refresh one at a time. */
export type IntelSourceKey = z.infer<typeof IntelSourceKey>;

/** Display label per refreshable source. */
export const INTEL_SOURCE_LABEL: Record<IntelSourceKey, string> = {
  hiring: 'Job boards',
  posts: 'Company posts',
  financials: 'Filings',
  registry: 'Registries',
};

/** Display label per financial period source. */
export const FINANCIAL_SOURCE_LABEL: Record<string, string> = {
  sec_edgar: 'SEC EDGAR',
  esef: 'ESEF (filings.xbrl.org)',
  brreg: 'Brønnøysund Register Centre',
  fr_rne: 'Recherche d\u2019entreprises (RNE)',
  fixture: 'Sample data',
};

/** How a line was obtained: read from a source, stated by the company, or inferred by Polo. */
export const IntelBasis = z.enum(['observed', 'stated', 'inferred']);
/** How a line was obtained. */
export type IntelBasis = z.infer<typeof IntelBasis>;

/** One evidence ledger entry: where a fact came from and the text it was read from. */
export const IntelEvidence = z.object({
  id: z.string().min(1),
  source: z.string(),
  sourceLabel: z.string(),
  url: z.string().nullable(),
  fetchedAt: Iso,
  excerpt: z.string().min(1),
  locator: z.string().nullable(),
  sample: z.boolean(),
});
/** One evidence ledger entry. */
export type IntelEvidence = z.infer<typeof IntelEvidence>;

/** A sentence on the direction view. Never without evidence. */
export const IntelClaim = z.object({
  id: z.string(),
  area: z.enum(['direction', 'financials', 'hiring', 'posts', 'news', 'investment']),
  text: z.string(),
  basis: IntelBasis,
  theme: InitiativeTheme.nullable(),
  evidenceIds: z.array(z.string()).min(1),
});
/** A sentence on the direction view. */
export type IntelClaim = z.infer<typeof IntelClaim>;

/** One line in "Where they're investing", "Where they're cutting" or "Likely next 12 months". */
export const InvestmentThemeItem = z.object({
  id: z.string(),
  direction: z.enum(['investing', 'cutting', 'next12']),
  area: z.string(),
  theme: InitiativeTheme.nullable(),
  label: z.string(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  trendPct: z.number().nullable(),
  basis: IntelBasis,
  summary: z.string(),
  evidenceIds: z.array(z.string()).min(1),
});
/** One investment plan line. */
export type InvestmentThemeItem = z.infer<typeof InvestmentThemeItem>;

/** Mantu offering that answers a theme, with the evidence behind the match. */
export const BidRelevance = z.object({
  theme: InitiativeTheme,
  label: z.string(),
  offering: z.string(),
  pitch: z.string(),
  nextStep: z.string(),
  score: z.number(),
  evidenceIds: z.array(z.string()).min(1),
});
/** Mantu offering that answers a theme. */
export type BidRelevance = z.infer<typeof BidRelevance>;

/** Last refresh of one source for one account. */
export const IntelSourceStatus = z.object({
  key: IntelSourceKey,
  label: z.string(),
  status: z.enum(['ok', 'partial', 'failed', 'not_configured', 'never', 'queued', 'running']),
  lastFetchedAt: Iso.nullable(),
  result: z.object({ new: z.number(), updated: z.number(), skipped: z.number(), failed: z.number() }),
  detail: z.string().nullable(),
});
/** Last refresh of one source for one account. */
export type IntelSourceStatus = z.infer<typeof IntelSourceStatus>;

/** Post types for company posts and news, mapped from the shared signal classifier. */
export const IntelPostKind = z.enum(['product', 'partnership', 'acquisition', 'leadership', 'results', 'layoffs', 'expansion', 'other']);
/** Post types for company posts and news. */
export type IntelPostKind = z.infer<typeof IntelPostKind>;

/** A company post (newsroom, IR, sitemap) or an external news item. */
export const IntelPost = z.object({
  id: z.string(),
  origin: z.enum(['own', 'news']),
  kind: IntelPostKind,
  title: z.string(),
  url: z.string().nullable(),
  publishedAt: Iso.nullable(),
  source: z.string(),
  sourceLabel: z.string(),
  sample: z.boolean(),
  evidenceId: z.string(),
});
/** A company post or an external news item. */
export type IntelPost = z.infer<typeof IntelPost>;

/** One open or recent job posting. */
export const IntelPosting = z.object({
  id: z.string(),
  title: z.string(),
  department: z.string().nullable(),
  function: z.string(),
  location: z.string().nullable(),
  seniority: z.string().nullable(),
  skills: z.array(z.string()),
  postedAt: Iso.nullable(),
  url: z.string().nullable(),
  source: z.string(),
  sample: z.boolean(),
});
/** One job posting. */
export type IntelPosting = z.infer<typeof IntelPosting>;

/** Open roles, 30 and 90 day trend, function mix and skills. */
export const HiringSummary = z.object({
  openRoles: z.number(),
  posted30: z.number(),
  postedPrev30: z.number(),
  posted90: z.number(),
  postedPrev90: z.number(),
  trend30Pct: z.number().nullable(),
  trend90Pct: z.number().nullable(),
  monthly: z.array(z.number()),
  byFunction: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })),
  skills: z.array(z.object({ skill: z.string(), count: z.number(), theme: InitiativeTheme.nullable() })),
  sources: z.array(z.string()),
});
/** Hiring summary. */
export type HiringSummary = z.infer<typeof HiringSummary>;

/** One fiscal year of filed or registry figures. Amounts are in `currency`. */
export const IntelFinancialYear = z.object({
  fiscalYear: z.number(),
  periodEnd: z.string(),
  currency: z.string().nullable(),
  source: z.string(),
  sourceUrl: z.string().nullable(),
  revenue: z.number().nullable(),
  operatingMargin: z.number().nullable(),
  netMargin: z.number().nullable(),
  capex: z.number().nullable(),
  rnd: z.number().nullable(),
  acquisitions: z.number().nullable(),
  intangibles: z.number().nullable(),
  debtIssued: z.number().nullable(),
  cash: z.number().nullable(),
  debt: z.number().nullable(),
  headcount: z.number().nullable(),
  restructuring: z.number().nullable(),
  sample: z.boolean(),
  evidenceId: z.string(),
});
/** One fiscal year of figures. */
export type IntelFinancialYear = z.infer<typeof IntelFinancialYear>;

/** A registry fact such as status or incorporation date. */
export const IntelRegistryFact = z.object({
  label: z.string(),
  value: z.string(),
  source: z.string(),
  sourceUrl: z.string().nullable(),
  fetchedAt: Iso,
});
/** A registry fact. */
export type IntelRegistryFact = z.infer<typeof IntelRegistryFact>;

/** Revenue range from a data provider, used only when no filed revenue exists. */
export const IntelRevenueFallback = z.object({
  label: z.string(),
  amountUsd: z.number().nullable(),
  source: z.string(),
  asOf: Iso.nullable(),
});
/** Revenue range from a data provider. */
export type IntelRevenueFallback = z.infer<typeof IntelRevenueFallback>;

/** GET /companies/:id/intel/direction */
export const AccountDirection = z.object({
  companyId: z.string(),
  companyName: z.string(),
  computedAt: Iso,
  headline: IntelClaim.nullable(),
  claims: z.array(IntelClaim),
  investing: z.array(InvestmentThemeItem),
  cutting: z.array(InvestmentThemeItem),
  next12: z.array(InvestmentThemeItem),
  bidRelevance: z.array(BidRelevance),
  evidence: z.array(IntelEvidence),
  sources: z.array(IntelSourceStatus),
  sample: z.boolean(),
});
/** Direction view payload. */
export type AccountDirection = z.infer<typeof AccountDirection>;

/** GET /companies/:id/intel/hiring */
export const AccountHiringIntel = z.object({
  companyId: z.string(),
  summary: HiringSummary,
  postings: z.array(IntelPosting),
  sample: z.boolean(),
});
/** Hiring payload. */
export type AccountHiringIntel = z.infer<typeof AccountHiringIntel>;

/** GET /companies/:id/intel/financials */
export const AccountFinancialsIntel = z.object({
  companyId: z.string(),
  years: z.array(IntelFinancialYear),
  revenueFallback: IntelRevenueFallback.nullable(),
  registry: z.array(IntelRegistryFact),
  sample: z.boolean(),
});
/** Financials payload. */
export type AccountFinancialsIntel = z.infer<typeof AccountFinancialsIntel>;

/** GET /companies/:id/intel/news */
export const AccountNewsIntel = z.object({
  companyId: z.string(),
  items: z.array(IntelPost),
  sample: z.boolean(),
});
/** News and posts payload. */
export type AccountNewsIntel = z.infer<typeof AccountNewsIntel>;

/** POST /companies/:id/intel/refresh body. */
export const IntelRefreshBody = z.object({ source: IntelSourceKey }).strict();
/** Refresh body. */
export type IntelRefreshBody = z.infer<typeof IntelRefreshBody>;

/** POST /companies/:id/intel/refresh response. */
export const IntelRefreshResponse = z.object({ queued: z.boolean(), source: IntelSourceKey, status: IntelSourceStatus });
/** Refresh response. */
export type IntelRefreshResponse = z.infer<typeof IntelRefreshResponse>;
