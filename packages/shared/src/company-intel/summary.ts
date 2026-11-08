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
    .object({
      monthly: z.array(z.number()),
      source: z.string(),
      sourceLabel: z.string(),
      asOf: Iso.nullable(),
      sample: z.boolean(),
    })
    .nullable(),
  hiringMix: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })),
  topSkills: z.array(z.string()),
  funding: IntelMetric.extend({
    latestRound: z.string().nullable(),
    latestRoundAt: Iso.nullable(),
  }).nullable(),
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
export type IntelSummaryRuns = Partial<
  Record<
    'hiring' | 'posts' | 'financials' | 'registry',
    { status: string; lastFetchedAt: string | null }
  >
>;

/** Everything the summary is built from. */
export interface IntelSummaryInput {
  companyId: string;
  now: Date;
  years: IntelSummaryYear[];
  postings: IntelSummaryPosting[];
  /** True when the posting read stopped at the memory ceiling and more rows exist. */
  postingsTruncated?: boolean;
  posts: IntelSummaryPost[];
  firmographics: IntelSummaryFirmographics | null;
  crm: { employeeCount: number | null; industry: string | null; updatedAt: string | null };
  /** Which sources are configured on the server. */
  connections: { publicSources: boolean; apollo: boolean };
  runs: IntelSummaryRuns;
}

/** Enrichment progress for the companies one import created. */
export const IntelImportBatchView = z.object({
  id: z.string(),
  migrationJobId: z.string().nullable(),
  origin: z.enum(['csv', 'hubspot']),
  total: z.number(),
  done: z.number(),
  failed: z.number(),
  status: z.enum(['running', 'complete']),
  summary: z.object({
    withRevenue: z.number().optional(),
    withHeadcountGrowth: z.number().optional(),
    withNewRoles30d: z.number().optional(),
    withDirection: z.number().optional(),
  }),
  createdAt: Iso,
  completedAt: Iso.nullable(),
});
/** Enrichment progress for one import. */
export type IntelImportBatchView = z.infer<typeof IntelImportBatchView>;

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

/**
 * USD per unit, rounded long-run rates. Used only to filter and sort revenue
 * across currencies ("Revenue over 1B"); the list always shows the filed
 * currency. Approximate by design, so the value is marked inferred.
 */
const USD_PER_UNIT: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CHF: 1.12,
  NOK: 0.093,
  SEK: 0.094,
  DKK: 0.145,
  CAD: 0.73,
  AUD: 0.66,
  JPY: 0.0067,
  CNY: 0.14,
  INR: 0.012,
  BRL: 0.18,
  MXN: 0.055,
  PLN: 0.25,
  CZK: 0.043,
};

/** Approximate USD for filtering and sorting only. Null for unknown currencies. */
export function approxUsd(amount: number, currency: string | null): number | null {
  const rate = USD_PER_UNIT[(currency ?? 'USD').toUpperCase()];
  return rate === undefined ? null : Math.round(amount * rate);
}

const DAY = 86_400_000;
const FILED = new Set(['sec_edgar', 'esef']);
const REGISTRY = new Set(['brreg', 'fr_rne', 'companies_house']);
const PERIOD_PRIORITY: Record<string, number> = {
  sec_edgar: 0,
  esef: 1,
  brreg: 2,
  fr_rne: 3,
  companies_house: 4,
  manual_import: 5,
  fixture: 9,
};
const PERIOD_LABEL: Record<string, string> = {
  ...FINANCIAL_SOURCE_LABEL,
  companies_house: 'Companies House',
  manual_import: 'Imported financials',
};
const POSTING_LABEL: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  recruitee: 'Recruitee',
  personio: 'Personio',
  careers_jsonld: 'Careers page',
  theirstack: 'TheirStack',
  adzuna: 'Adzuna',
  apollo: 'Apollo',
  seamless: 'Seamless',
  fixture: 'Sample data',
};
const PROVIDER_LABEL: Record<string, string> = {
  apollo: 'Apollo',
  seamless: 'Seamless',
  fixture: 'Sample data',
};
const SIGNAL_WINDOW_DAYS = 180;

const providerLabel = (s: string) => PROVIDER_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

function periodMethod(source: string, fy: number): string {
  if (FILED.has(source)) return `Filed annual accounts FY${fy}`;
  if (REGISTRY.has(source)) return `Registry accounts FY${fy}`;
  if (source === 'manual_import') return `Imported financials FY${fy}`;
  return `Sample figures FY${fy}`;
}

/** Lower bound of a provider range such as "$1B-$10B" or "$10B+", in USD. */
function rangeLow(range: string | null): number | null {
  const m = range?.match(/\$?\s*([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  const v = Number(m[1]) * mult;
  return Number.isFinite(v) && v > 0 ? v : null;
}

function pctChange(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function signed(n: number): string {
  const r = Math.abs(n) < 1 ? Math.round(n * 10) / 10 : Math.round(n);
  return `${r > 0 ? '+' : ''}${r}%`;
}

function latestIso(values: Array<string | Date | null | undefined>): string | null {
  let best: number | null = null;
  for (const v of values) {
    if (!v) continue;
    const t = v instanceof Date ? v.getTime() : Date.parse(v);
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Best period per fiscal year (filings before registries before imports before samples).
 * Callers filter to records carrying the metric first, so a preferred record
 * missing that metric never hides a lower-priority one that has it. */
function bestYears(years: IntelSummaryYear[]): IntelSummaryYear[] {
  const by = new Map<number, IntelSummaryYear>();
  for (const y of years) {
    const cur = by.get(y.fiscalYear);
    if (!cur || (PERIOD_PRIORITY[y.source] ?? 6) < (PERIOD_PRIORITY[cur.source] ?? 6))
      by.set(y.fiscalYear, y);
  }
  return [...by.values()].sort((a, b) => b.fiscalYear - a.fiscalYear);
}

/** Build the summary for one company. */
export function buildIntelSummary(input: IntelSummaryInput): CompanyIntelSummary {
  const { now, firmographics: f, connections, runs } = input;
  const gaps: Record<string, IntelGap> = {};
  const gap = (field: IntelSummaryField, reason: IntelEmptyReason, detail: string) => {
    gaps[field] = { reason, detail };
  };
  const ran = (k: keyof IntelSummaryRuns) =>
    Boolean(runs[k] && ['ok', 'partial'].includes(runs[k]!.status));
  const fAsOf = (field: string) => f?.provenance[field]?.fetchedAt ?? f?.fetchedAt ?? null;
  const fSource = (field: string) => f?.provenance[field]?.source ?? 'apollo';
  const isSampleSource = (s: string) => s === 'fixture';

  // Revenue: filings and registries first, the provider estimate as a labelled fallback.
  let revenue: CompanyIntelSummary['revenue'] = null;
  let revenueGrowth: CompanyIntelSummary['revenueGrowth'] = null;
  const withRevenue = bestYears(input.years.filter((y) => y.revenue != null && y.revenue > 0));
  const latest = withRevenue[0];
  if (latest) {
    revenue = {
      value: latest.revenue!,
      source: latest.source,
      sourceLabel: PERIOD_LABEL[latest.source] ?? latest.source,
      asOf: latest.fetchedAt ?? `${latest.periodEnd}T00:00:00.000Z`,
      method: periodMethod(latest.source, latest.fiscalYear),
      inferred: false,
      sample: isSampleSource(latest.source),
      currency: latest.currency,
      fiscalYear: latest.fiscalYear,
      range: null,
      approxUsd: approxUsd(latest.revenue!, latest.currency),
    };
    const prev = withRevenue.find(
      (y) => y.fiscalYear === latest.fiscalYear - 1 && y.currency === latest.currency,
    );
    const g = prev ? pctChange(latest.revenue!, prev.revenue!) : null;
    if (prev && g !== null) {
      revenueGrowth = {
        value: g,
        source: latest.source,
        sourceLabel: PERIOD_LABEL[latest.source] ?? latest.source,
        asOf: revenue.asOf,
        method: `Derived from FY${prev.fiscalYear} and FY${latest.fiscalYear} revenue`,
        inferred: true,
        sample: revenue.sample,
        fromYear: prev.fiscalYear,
        toYear: latest.fiscalYear,
      };
    }
  } else if (f && (f.annualRevenueUsd != null || rangeLow(f.revenueRange) != null)) {
    const src = fSource('annualRevenueUsd');
    const low = rangeLow(f.revenueRange);
    revenue = {
      value: f.annualRevenueUsd ?? low!,
      source: src,
      sourceLabel: providerLabel(src),
      asOf: fAsOf('annualRevenueUsd'),
      method:
        f.annualRevenueUsd != null
          ? 'Provider revenue estimate'
          : `Provider revenue estimate, range ${f.revenueRange}, low end used for sorting`,
      inferred: f.annualRevenueUsd == null,
      sample: isSampleSource(src),
      currency: 'USD',
      fiscalYear: null,
      range: f.revenueRange,
      approxUsd: f.annualRevenueUsd ?? low,
    };
  }
  if (!revenue) {
    if (!connections.publicSources && !connections.apollo)
      gap('revenue', 'not_connected', 'Public sources and Apollo are not connected');
    else if (ran('financials') || ran('registry'))
      gap(
        'revenue',
        'private_company',
        connections.apollo
          ? 'No published accounts and no provider estimate'
          : 'No published accounts; Apollo not connected',
      );
    else gap('revenue', 'no_public_data', 'No filings or provider estimate yet');
  }
  if (!revenueGrowth)
    gaps.revenueGrowth = revenue
      ? { reason: 'no_public_data', detail: 'Needs two consecutive filed years' }
      : (gaps.revenue ?? { reason: 'no_public_data', detail: 'No revenue' });

  // Headcount and growth: provider org data, then filed headcount, then the CRM record.
  const filedHead = bestYears(input.years.filter((y) => y.headcount != null && y.headcount > 0));
  let headcount: CompanyIntelSummary['headcount'] = null;
  if (f?.employeeCount != null) {
    const src = fSource('employeeCount');
    headcount = {
      value: f.employeeCount,
      source: src,
      sourceLabel: providerLabel(src),
      asOf: fAsOf('employeeCount'),
      method: 'Provider employee estimate',
      inferred: false,
      sample: isSampleSource(src),
    };
  } else if (filedHead[0]) {
    const y = filedHead[0];
    headcount = {
      value: y.headcount!,
      source: y.source,
      sourceLabel: PERIOD_LABEL[y.source] ?? y.source,
      asOf: y.fetchedAt,
      method: `Employees in ${periodMethod(y.source, y.fiscalYear).toLowerCase()}`,
      inferred: false,
      sample: isSampleSource(y.source),
    };
  } else if (input.crm.employeeCount != null) {
    headcount = {
      value: input.crm.employeeCount,
      source: 'crm',
      sourceLabel: 'CRM record',
      asOf: input.crm.updatedAt,
      method: 'Employee count on the CRM record',
      inferred: false,
      sample: false,
    };
  }
  if (!headcount)
    gap(
      'headcount',
      connections.apollo || connections.publicSources ? 'no_public_data' : 'not_connected',
      connections.apollo ? 'No employee count found' : 'Apollo not connected; no filed headcount',
    );

  let headcountGrowth: CompanyIntelSummary['headcountGrowth'] = null;
  const g6 = f?.headcountGrowth6m;
  const g12 = f?.headcountGrowth12m;
  if (g6 != null || g12 != null) {
    const six = g6 != null;
    const field = six ? 'headcountGrowth6m' : 'headcountGrowth12m';
    const src = fSource(field);
    headcountGrowth = {
      value: Math.round((six ? g6! : g12!) * 1000) / 10,
      source: src,
      sourceLabel: providerLabel(src),
      asOf: fAsOf(field),
      method: `Provider headcount growth over ${six ? '6' : '12'} months`,
      inferred: false,
      sample: isSampleSource(src),
      window: six ? '6m' : '12m',
    };
  } else if (filedHead.length >= 2 && filedHead[1]!.fiscalYear === filedHead[0]!.fiscalYear - 1) {
    const [cur, prev] = filedHead as [IntelSummaryYear, IntelSummaryYear];
    const v = pctChange(cur.headcount!, prev.headcount!);
    if (v !== null) {
      headcountGrowth = {
        value: v,
        source: cur.source,
        sourceLabel: PERIOD_LABEL[cur.source] ?? cur.source,
        asOf: cur.fetchedAt,
        method: `Derived from filed headcount FY${prev.fiscalYear} to FY${cur.fiscalYear}`,
        inferred: true,
        sample: isSampleSource(cur.source),
        window: '12m',
      };
    }
  }
  if (!headcountGrowth)
    gap(
      'headcountGrowth',
      connections.apollo ? 'no_public_data' : 'not_connected',
      connections.apollo
        ? 'No headcount trend from Apollo or filings'
        : 'Apollo not connected; filings show no headcount trend',
    );

  // Hiring: public job boards. New postings in 30 days is the hiring proxy, never a hire count.
  let openRoles: CompanyIntelSummary['openRoles'] = null;
  let newRoles30d: CompanyIntelSummary['newRoles30d'] = null;
  let hiringTrend: CompanyIntelSummary['hiringTrend'] = null;
  let hiringMix: CompanyIntelSummary['hiringMix'] = [];
  let topSkills: string[] = [];
  // Sample postings stay after a live refresh; once live postings exist they alone count.
  const livePostings = input.postings.filter((p) => !p.sample);
  const postings = livePostings.length ? livePostings : input.postings;
  if (postings.length) {
    const h = summarizeHiring(postings, now);
    const sources = h.sources;
    const allSample = postings.every((p) => p.sample);
    const label = sources.map((s) => POSTING_LABEL[s] ?? s).join(', ');
    const asOf = latestIso(postings.map((p) => p.fetchedAt ?? p.lastSeenAt));
    const base = {
      source: allSample ? 'fixture' : 'job_boards',
      sourceLabel: label,
      asOf,
      inferred: false,
      sample: allSample,
    };
    const ceiling = input.postingsTruncated
      ? ' Stopped at 20000 qualifying postings; this is not the full board.'
      : '';
    openRoles = {
      ...base,
      value: h.openRoles,
      method: `Open postings on public job boards, seen in the last 45 days.${ceiling}`,
    };
    newRoles30d = {
      ...base,
      value: h.posted30,
      method: `Postings first published in the last 30 days (hiring proxy).${ceiling}`,
      prev30: h.postedPrev30,
      trend30Pct: h.trend30Pct,
      trend90Pct: h.trend90Pct,
    };
    hiringTrend = {
      monthly: h.monthly,
      source: base.source,
      sourceLabel: input.postingsTruncated ? `${label}.${ceiling}` : label,
      asOf,
      sample: allSample,
    };
    hiringMix = h.byFunction
      .slice(0, 6)
      .map((x) => ({ key: x.key, label: FUNCTION_LABEL[x.key] ?? x.label, count: x.count }));
    topSkills = h.skills.slice(0, 6).map((s) => s.skill);
  } else {
    const reason: IntelEmptyReason = connections.publicSources ? 'no_public_data' : 'not_connected';
    const detail = connections.publicSources
      ? ran('hiring')
        ? 'No public job board found'
        : 'Job boards not read yet'
      : 'Public job boards are not connected';
    for (const k of ['openRoles', 'newRoles30d', 'hiringTrend'] as const) gap(k, reason, detail);
  }

  let funding: CompanyIntelSummary['funding'] = null;
  if (f?.totalFundingUsd != null && f.totalFundingUsd > 0) {
    const src = fSource('totalFundingUsd');
    funding = {
      value: f.totalFundingUsd,
      source: src,
      sourceLabel: providerLabel(src),
      asOf: fAsOf('totalFundingUsd'),
      method: 'Provider total funding',
      inferred: false,
      sample: isSampleSource(src),
      latestRound: f.latestFundingStage,
      latestRoundAt: f.latestFundingAt,
    };
  } else
    gap(
      'funding',
      connections.apollo ? 'no_public_data' : 'not_connected',
      connections.apollo ? 'No funding rounds reported' : 'Apollo not connected',
    );

  const recent = input.posts
    .filter(
      (p) => p.publishedAt && now.getTime() - Date.parse(p.publishedAt) <= SIGNAL_WINDOW_DAYS * DAY,
    )
    .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!));
  const top = recent.find((p) => p.kind !== 'other') ?? recent[0] ?? null;
  const signal: CompanyIntelSummary['signal'] = top
    ? {
        kind: top.kind,
        label: POST_KIND_LABEL[top.kind],
        title: top.title,
        url: top.url,
        publishedAt: top.publishedAt,
        sourceLabel: top.sourceLabel,
        sample: top.sample,
      }
    : null;
  if (!signal)
    gap(
      'signal',
      connections.publicSources ? 'no_public_data' : 'not_connected',
      connections.publicSources
        ? 'No company posts or news in 6 months'
        : 'Public sources are not connected',
    );

  // Direction: Polo's read of the signals above, always inferred.
  const plus: string[] = [];
  const minus: string[] = [];
  if (headcountGrowth) {
    const t = headcountGrowth.window === '6m' ? 3 : 5;
    const text = `Headcount ${headcountGrowth.value >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(headcountGrowth.value))}% in ${headcountGrowth.window === '6m' ? '6' : '12'} months (${headcountGrowth.sourceLabel})`;
    if (headcountGrowth.value >= t) plus.push(text);
    else if (headcountGrowth.value <= -t) minus.push(text);
  }
  if (revenueGrowth) {
    const text = `Revenue ${revenueGrowth.value >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(revenueGrowth.value))}% in FY${revenueGrowth.toYear}`;
    if (revenueGrowth.value >= 5) plus.push(text);
    else if (revenueGrowth.value <= -5) minus.push(text);
  }
  if (newRoles30d && !input.postingsTruncated) {
    const t = newRoles30d.trend30Pct;
    if (
      newRoles30d.value >= 3 &&
      (t === null ? newRoles30d.prev30 === 0 && newRoles30d.value >= 5 : t >= 25)
    ) {
      plus.push(
        `${newRoles30d.value} new postings in 30 days${t !== null ? `, ${signed(t)} vs the prior 30` : ''}`,
      );
    } else if (t !== null && t <= -40 && newRoles30d.prev30 >= 3) {
      minus.push(`New postings ${signed(t)} vs the prior 30 days`);
    }
  }
  for (const p of recent.slice(0, 10)) {
    if (p.kind === 'layoffs') minus.push(`Layoffs post: ${p.title}`);
    else if (p.kind === 'expansion' || p.kind === 'acquisition')
      plus.push(`${POST_KIND_LABEL[p.kind]} post: ${p.title}`);
  }
  const score = plus.length - minus.length;
  const hiringUsable = Boolean(newRoles30d) && !input.postingsTruncated;
  const hasInputs = Boolean(headcountGrowth || revenueGrowth || hiringUsable || recent.length);
  const direction: CompanyIntelSummary['direction'] = hasInputs
    ? {
        value: score >= 1 ? 'growing' : score <= -1 ? 'contracting' : 'steady',
        reasons:
          score >= 1
            ? [...plus, ...minus]
            : score <= -1
              ? [...minus, ...plus]
              : [...plus, ...minus].length
                ? [...plus, ...minus]
                : ['No strong move in headcount, revenue or postings'],
        inferred: true,
      }
    : null;
  if (!direction) gap('direction', 'no_public_data', 'Not enough signals to read a direction');

  const metrics = [
    revenue,
    revenueGrowth,
    headcount,
    headcountGrowth,
    openRoles,
    newRoles30d,
    funding,
  ];
  const sample = metrics.some((m) => m?.sample) || Boolean(signal?.sample);
  return {
    companyId: input.companyId,
    computedAt: now.toISOString(),
    revenue,
    revenueGrowth,
    headcount,
    headcountGrowth,
    openRoles,
    newRoles30d,
    hiringTrend,
    hiringMix,
    topSkills,
    funding,
    foundedYear: f?.foundedYear ?? null,
    industry: f?.industry ?? input.crm.industry,
    technologies: (f?.techStack ?? []).slice(0, 12),
    departmentHeadcount: Object.entries(f?.departmentHeadcount ?? {})
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    signal,
    direction,
    gaps,
    sample,
  };
}
