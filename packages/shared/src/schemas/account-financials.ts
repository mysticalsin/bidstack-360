import { z } from 'zod';

/**
 * v23: financial statements and early-warning signals per account, from free
 * public filings only (SEC EDGAR XBRL, ESEF via filings.xbrl.org).
 *
 * Gating: the scheduled pull runs only for Strategic (tier 'key') and Top
 * (tier 'top' or a curated top-account rank) accounts. General accounts
 * ('standard') are pulled only when an Admin or AE turns on "Track financials".
 */

export const TIER_LABEL = { key: 'Strategic', top: 'Top', standard: 'General' } as const;
export type CompanyTier = keyof typeof TIER_LABEL;

export function tierLabel(tier: string | null | undefined): (typeof TIER_LABEL)[CompanyTier] {
  return TIER_LABEL[(tier ?? 'standard') as CompanyTier] ?? 'General';
}

export type FinancialsGate = 'tier' | 'top_rank' | 'opt_in' | 'general';

export interface FinancialsGateInput {
  tier: string | null | undefined;
  topAccountRank?: number | null;
  trackFinancials?: boolean | null;
}

/** Why an account is (or is not) in the scheduled financials pull. */
export function financialsGate(c: FinancialsGateInput): FinancialsGate {
  if (c.tier === 'key' || c.tier === 'top') return 'tier';
  if (c.topAccountRank != null) return 'top_rank';
  if (c.trackFinancials) return 'opt_in';
  return 'general';
}

export function financialsEligible(c: FinancialsGateInput): boolean {
  return financialsGate(c) !== 'general';
}

export const GATE_COPY: Record<FinancialsGate, string> = {
  tier: 'Pulled automatically because this is a Strategic or Top account.',
  top_rank: 'Pulled automatically because this account is on the curated top accounts list.',
  opt_in: 'Pulled because someone turned on Track financials for this account.',
  general:
    'General accounts are not pulled automatically, to keep the scan small and polite to the public sources. Turn on Track financials to opt this account in.',
};

export const FINANCIAL_METRICS = [
  'revenue',
  'operatingIncome',
  'ebitda',
  'netIncome',
  'capex',
  'rnd',
  'opex',
  'employeeCost',
  'headcount',
  'cash',
  'debt',
  'operatingCashFlow',
  'acquisitions',
  'restructuring',
  'impairment',
] as const;
export const FinancialMetric = z.enum(FINANCIAL_METRICS);
export type FinancialMetric = z.infer<typeof FinancialMetric>;

export const METRIC_LABEL: Record<FinancialMetric | 'operatingMargin' | 'netMargin' | 'freeCashFlow', string> = {
  revenue: 'Revenue',
  operatingIncome: 'Operating profit',
  ebitda: 'EBITDA',
  netIncome: 'Net income',
  capex: 'Capex',
  rnd: 'R&D',
  opex: 'Opex / SG&A',
  employeeCost: 'Staff costs',
  headcount: 'Headcount',
  cash: 'Cash',
  debt: 'Debt',
  operatingCashFlow: 'Operating cash flow',
  acquisitions: 'Acquisitions paid',
  restructuring: 'Restructuring charges',
  impairment: 'Impairments',
  operatingMargin: 'Operating margin',
  netMargin: 'Net margin',
  freeCashFlow: 'Free cash flow',
};

export const FinancialValue = z.object({
  value: z.number(),
  /** XBRL concept the number came from, e.g. ifrs-full:Revenue. */
  concept: z.string(),
});
export type FinancialValue = z.infer<typeof FinancialValue>;

export const FinancialPeriod = z.object({
  periodType: z.enum(['FY', 'Q']),
  fiscalYear: z.number().int(),
  periodStart: z.string().nullable(),
  periodEnd: z.string(),
  currency: z.string(),
  source: z.string(),
  sourceUrl: z.string(),
  filedAt: z.string().nullable(),
  metrics: z.record(z.string(), FinancialValue),
  /** Derived here, never by the filer: operating and net margin %, free cash flow. */
  derived: z.object({
    operatingMargin: z.number().nullable(),
    netMargin: z.number().nullable().default(null),
    freeCashFlow: z.number().nullable(),
  }),
});
export type FinancialPeriod = z.infer<typeof FinancialPeriod>;

export const FinancialSignalRule = z.enum([
  'capex_up',
  'rnd_up',
  'margin_squeeze',
  'restructuring_charge',
  'debt_jump',
  'impairment',
  'acquisitions',
  'guidance_cut',
  'text_cue',
]);
export type FinancialSignalRule = z.infer<typeof FinancialSignalRule>;

export const FinancialSignal = z.object({
  id: z.string(),
  rule: FinancialSignalRule,
  title: z.string(),
  explanation: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  implication: z.enum(['OPPORTUNITY', 'RISK', 'NEUTRAL']),
  periodEnd: z.string(),
  sourceUrl: z.string(),
  snippet: z.string().nullable(),
  sample: z.boolean(),
});
export type FinancialSignal = z.infer<typeof FinancialSignal>;

export const AccountFinancials = z.object({
  companyId: z.string(),
  tier: z.string(),
  tierLabel: z.string(),
  gate: z.enum(['tier', 'top_rank', 'opt_in', 'general']),
  gateCopy: z.string(),
  trackFinancials: z.boolean(),
  canToggle: z.boolean(),
  /** ok | pending | no_identifier | no_source | mismatch | error | paused */
  status: z.string(),
  statusCopy: z.string().nullable(),
  entity: z.object({ source: z.string(), id: z.string(), name: z.string() }).nullable(),
  lastPulledAt: z.string().nullable(),
  nextPullAt: z.string().nullable(),
  periods: z.array(FinancialPeriod),
  signals: z.array(FinancialSignal),
  /** True when the section shows the built-in example instead of filings. */
  sample: z.boolean(),
});
export type AccountFinancials = z.infer<typeof AccountFinancials>;

export const TrackFinancialsUpdate = z.object({ trackFinancials: z.boolean() });
export type TrackFinancialsUpdate = z.infer<typeof TrackFinancialsUpdate>;

/** Plain status copy for the empty states. */
export const FINANCIALS_STATUS_COPY: Record<string, string> = {
  pending: 'Queued: the next financials pull will fill this in.',
  no_identifier: 'Add an SEC CIK or an LEI to this account to pull its filed statements.',
  no_source: 'No free machine-readable filings found for this company yet.',
  mismatch: 'The filing entity name does not match this account, so nothing was stored. Check the CIK or LEI.',
  error: 'The last pull failed. It will retry on the next run.',
  paused: 'Not tracked: this is a General account without Track financials.',
};

/**
 * Built-in example shown (labeled Sample) when an account has no filed
 * statements yet, so the section shape is visible. Round, obviously fictional
 * numbers; never mixed with real periods.
 */
function samplePeriod(year: number, revenue: number, op: number, capex: number, cash: number): FinancialPeriod {
  const v = (value: number) => ({ value, concept: 'sample' });
  return {
    periodType: 'FY',
    fiscalYear: year,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    currency: 'EUR',
    source: 'sample',
    sourceUrl: '',
    filedAt: null,
    metrics: { revenue: v(revenue), operatingIncome: v(op), capex: v(capex), cash: v(cash) },
    derived: { operatingMargin: Math.round((op / revenue) * 1000) / 10, netMargin: null, freeCashFlow: null },
  };
}

export const SAMPLE_FINANCIAL_PERIODS: FinancialPeriod[] = [
  samplePeriod(2025, 1_200_000_000, 132_000_000, 140_000_000, 210_000_000),
  samplePeriod(2024, 1_100_000_000, 143_000_000, 100_000_000, 260_000_000),
  samplePeriod(2023, 1_000_000_000, 120_000_000, 90_000_000, 240_000_000),
];

export const SAMPLE_FINANCIAL_SIGNALS: FinancialSignal[] = [
  {
    id: 'sample:capex_up',
    rule: 'capex_up',
    title: 'Sample: Capex up 40%: likely expansion program',
    explanation: 'Example only. When capex grows much faster than revenue, a new plant, platform or rollout is usually being funded.',
    confidence: 'medium',
    implication: 'OPPORTUNITY',
    periodEnd: '2025-12-31',
    sourceUrl: '',
    snippet: null,
    sample: true,
  },
  {
    id: 'sample:margin_squeeze',
    rule: 'margin_squeeze',
    title: 'Sample: Operating margin down 2 pts',
    explanation: 'Example only. Margin pressure often comes before cost programmes and reorganisations.',
    confidence: 'low',
    implication: 'RISK',
    periodEnd: '2025-12-31',
    sourceUrl: '',
    snippet: null,
    sample: true,
  },
];
