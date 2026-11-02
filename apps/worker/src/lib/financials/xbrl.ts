/**
 * v23: turn free XBRL data into annual (and, for EDGAR, quarterly) key lines.
 *
 * Sources:
 *   - SEC EDGAR companyfacts (https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json)
 *   - ESEF xBRL-JSON from filings.xbrl.org (one file per annual report)
 *
 * Only undimensioned (consolidated total) facts are used. Nothing is
 * estimated: a metric is either the filed number with its concept, or absent.
 */
import { signedUnitsToMicros, type FinancialMetric, type FinancialValue } from '@bidstack/shared';

/** Concepts per metric, first match wins. `*:Name` matches any prefix (filer extensions). */
export const CONCEPTS: Record<FinancialMetric, string[]> = {
  revenue: [
    'ifrs-full:Revenue',
    'ifrs-full:RevenueFromContractsWithCustomers',
    'ifrs-full:InsuranceRevenue',
    '*:IncomeArisingFromInsuranceContracts',
    'ifrs-full:RevenueAndOperatingIncome',
    'us-gaap:Revenues',
    'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
    'us-gaap:SalesRevenueNet',
  ],
  operatingIncome: ['ifrs-full:ProfitLossFromOperatingActivities', 'us-gaap:OperatingIncomeLoss', '*:OperatingIncomeExpense', '*:OperatingProfitLoss'],
  ebitda: ['*:EBITDA', '*:Ebitda', '*:AdjustedEBITDA'],
  netIncome: ['ifrs-full:ProfitLoss', 'us-gaap:NetIncomeLoss', 'us-gaap:ProfitLoss'],
  capex: [
    'ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
    'ifrs-full:PurchaseOfPropertyPlantAndEquipment',
    'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment',
    'us-gaap:PaymentsToAcquireProductiveAssets',
  ],
  rnd: ['ifrs-full:ResearchAndDevelopmentExpense', 'us-gaap:ResearchAndDevelopmentExpense', 'us-gaap:ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'],
  opex: [
    'ifrs-full:OperatingExpense',
    'ifrs-full:SellingGeneralAndAdministrativeExpense',
    'ifrs-full:GeneralAndAdministrativeExpense',
    'ifrs-full:AdministrativeExpense',
    'us-gaap:OperatingExpenses',
    'us-gaap:SellingGeneralAndAdministrativeExpense',
  ],
  employeeCost: ['ifrs-full:EmployeeBenefitsExpense', 'us-gaap:LaborAndRelatedExpense'],
  headcount: ['*:NumberOfEmployees', '*:AverageNumberOfEmployees', 'dei:EntityNumberOfEmployees'],
  cash: ['ifrs-full:CashAndCashEquivalents', 'us-gaap:CashAndCashEquivalentsAtCarryingValue', 'us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  debt: [
    'ifrs-full:Borrowings',
    'us-gaap:LongTermDebt',
    'us-gaap:DebtInstrumentCarryingAmount',
    'ifrs-full:LongtermBorrowings',
    'us-gaap:LongTermDebtNoncurrent',
  ],
  operatingCashFlow: ['ifrs-full:CashFlowsFromUsedInOperatingActivities', 'us-gaap:NetCashProvidedByUsedInOperatingActivities'],
  acquisitions: [
    'ifrs-full:CashFlowsUsedInObtainingControlOfSubsidiariesOrOtherBusinessesClassifiedAsInvestingActivities',
    'us-gaap:PaymentsToAcquireBusinessesNetOfCashAcquired',
  ],
  restructuring: ['ifrs-full:ExpenseOfRestructuringActivities', 'us-gaap:RestructuringCharges', 'us-gaap:RestructuringCosts'],
  impairment: [
    'ifrs-full:ImpairmentLossRecognisedInProfitOrLoss',
    'ifrs-full:ImpairmentLossRecognisedInProfitOrLossGoodwill',
    'us-gaap:GoodwillImpairmentLoss',
    'us-gaap:AssetImpairmentCharges',
    'us-gaap:ImpairmentOfIntangibleAssetsExcludingGoodwill',
  ],
};

/** Balance-sheet (point in time) metrics; the rest are flows over the period. */
export const INSTANT: ReadonlySet<FinancialMetric> = new Set(['cash', 'debt', 'headcount']);

export interface RawFact {
  concept: string;
  /** Major units when they fit in a safe number. Null when they do not. */
  value: number | null;
  /** Integer micros text for a money fact. Absent for a headcount. */
  valueMicros?: string;
  unit: string;
  /** ISO date, inclusive. Null for instants. */
  start: string | null;
  /** ISO date, inclusive (period end or instant date). */
  end: string;
  filed?: string | null;
  form?: string | null;
}

export interface ExtractedPeriod {
  periodType: 'FY' | 'Q';
  fiscalYear: number;
  periodStart: string | null;
  periodEnd: string;
  currency: string;
  filedAt: string | null;
  metrics: Partial<Record<FinancialMetric, FinancialValue>>;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;

function matches(pattern: string, concept: string): boolean {
  if (pattern.startsWith('*:')) return concept.endsWith(`:${pattern.slice(2)}`);
  return pattern === concept;
}

/** Index of the first concept pattern that matches, or -1. */
function rank(metric: FinancialMetric, concept: string): number {
  return CONCEPTS[metric].findIndex((p) => matches(p, concept));
}

function periodKind(f: RawFact): 'FY' | 'Q' | 'instant' | null {
  if (!f.start) return 'instant';
  const n = days(f.start, f.end);
  if (n >= 330 && n <= 380) return 'FY';
  if (n >= 80 && n <= 100) return 'Q';
  return null;
}

const isMoneyUnit = (u: string) => /^[A-Z]{3}$/.test(u);

/**
 * Filed major units as integer micros. A digit string never passes through
 * Number(), so an amount past 2^53 keeps its cents. A number is accepted
 * only while unitsToMicros can hold it; otherwise the fact is omitted.
 */
export function filedMicros(raw: string | number | null | undefined): bigint | null {
  if (raw == null || raw === '') return null;
  return signedUnitsToMicros(raw);
}

/** Major units for ratios, only when every digit fits in a safe number. */
function majorUnitsIfSafe(micros: bigint): number | null {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const whole = abs / 1_000_000n;
  const rem = abs % 1_000_000n;
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  if (rem === 0n) return neg ? -Number(whole) : Number(whole);
  if (abs > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const amount = Number(whole) + Number(rem) / 1_000_000;
  return neg ? -amount : amount;
}

function moneyFields(f: Pick<RawFact, 'value' | 'valueMicros' | 'unit'>): { value?: number; valueMicros?: string } {
  let valueMicros = f.valueMicros;
  const value = f.value;
  if (!valueMicros && value != null && isMoneyUnit(f.unit)) {
    const micros = filedMicros(value);
    if (micros != null) valueMicros = micros.toString();
  }
  return {
    ...(value != null ? { value } : {}),
    ...(valueMicros ? { valueMicros } : {}),
  };
}

/**
 * Group facts into periods. Flows define the periods (by end date); instants
 * on the same end date fill cash, debt and headcount. When a filer restates a
 * number, the latest filing wins.
 */
export function buildPeriods(facts: RawFact[], opts: { quarters?: boolean } = {}): ExtractedPeriod[] {
  const periods = new Map<string, ExtractedPeriod & { _rank: Partial<Record<FinancialMetric, number>>; _filed: Partial<Record<FinancialMetric, string>> }>();
  const instants: RawFact[] = [];
  const metrics = Object.keys(CONCEPTS) as FinancialMetric[];
  const alts = new Map<string, Map<string, { value?: number; valueMicros?: string; filed: string }>>();
  const take = (p: ExtractedPeriod & { _rank: Partial<Record<FinancialMetric, number>>; _filed: Partial<Record<FinancialMetric, string>> }, m: FinancialMetric, f: RawFact) => {
    const r = rank(m, f.concept);
    const ak = `${p.periodType}:${p.periodEnd}:${m}`;
    const am = alts.get(ak) ?? new Map<string, { value?: number; valueMicros?: string; filed: string }>();
    const prevAlt = am.get(f.concept);
    const stored = moneyFields(f);
    if (!prevAlt || (f.filed ?? '') > prevAlt.filed) am.set(f.concept, { ...stored, filed: f.filed ?? '' });
    alts.set(ak, am);
    const prev = p._rank[m];
    const filed = f.filed ?? '';
    if (prev === undefined || r < prev || (r === prev && filed > (p._filed[m] ?? ''))) {
      p.metrics[m] = { ...stored, concept: f.concept };
      p._rank[m] = r;
      p._filed[m] = filed;
      if (filed && (!p.filedAt || filed > p.filedAt)) p.filedAt = filed;
    }
  };
  for (const f of facts) {
    const kind = periodKind(f);
    if (!kind) continue;
    if (kind === 'instant') {
      instants.push(f);
      continue;
    }
    if (kind === 'Q' && !opts.quarters) continue;
    const m = metrics.find((k) => !INSTANT.has(k) && rank(k, f.concept) >= 0);
    if (!m || !isMoneyUnit(f.unit)) continue;
    const key = `${kind}:${f.end}`;
    let p = periods.get(key);
    if (!p) {
      p = { periodType: kind, fiscalYear: Number(f.end.slice(0, 4)), periodStart: f.start, periodEnd: f.end, currency: f.unit, filedAt: null, metrics: {}, _rank: {}, _filed: {} };
      periods.set(key, p);
    }
    if (f.unit !== p.currency) continue;
    // A concept can belong to several metrics only by mistake; check all.
    for (const k of metrics) if (!INSTANT.has(k) && rank(k, f.concept) >= 0) take(p, k, f);
  }
  for (const f of instants) {
    for (const p of periods.values()) {
      if (p.periodEnd !== f.end) continue;
      for (const k of metrics) {
        if (!INSTANT.has(k) || rank(k, f.concept) < 0) continue;
        if (k === 'headcount' ? f.unit !== 'pure' && !/employee|people|person|pure/i.test(f.unit) : f.unit !== p.currency) continue;
        take(p, k, f);
      }
    }
  }
  const list = [...periods.values()]
    .filter((p) => p.metrics.revenue || p.metrics.netIncome)
    .map(({ _rank: _r, _filed: _f, ...p }) => p)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.periodType.localeCompare(b.periodType));
  // Comparable series: when an older period also filed the concept the latest
  // period uses, take that one (filers retag lines between years).
  for (const type of ['FY', 'Q'] as const) {
    const ps = list.filter((p) => p.periodType === type);
    const latest = ps[0];
    if (!latest) continue;
    for (const m of metrics) {
      const target = latest.metrics[m]?.concept;
      if (!target) continue;
      for (const p of ps.slice(1)) {
        const alt = alts.get(`${type}:${p.periodEnd}:${m}`)?.get(target);
        if (alt && p.metrics[m]?.concept !== target) {
          p.metrics[m] = {
            concept: target,
            ...(alt.value != null ? { value: alt.value } : {}),
            ...(alt.valueMicros ? { valueMicros: alt.valueMicros } : {}),
          };
        }
      }
    }
  }
  return list;
}

// ── SEC EDGAR companyfacts ───────────────────────────────────────────────────

export interface CompanyFacts {
  cik: number | string;
  entityName: string;
  facts: Record<string, Record<string, { units: Record<string, Array<{ start?: string; end: string; val: number; fy?: number; fp?: string; form?: string; filed?: string; frame?: string }>> }>>;
}

const ANNUAL_FORMS = /^(10-K|20-F|40-F)(\/A)?$/;
const QUARTER_FORMS = /^(10-Q)(\/A)?$/;

export function factsFromCompanyFacts(cf: CompanyFacts): RawFact[] {
  const out: RawFact[] = [];
  for (const [ns, concepts] of Object.entries(cf.facts)) {
    for (const [name, c] of Object.entries(concepts)) {
      const concept = `${ns}:${name}`;
      if (!(Object.keys(CONCEPTS) as FinancialMetric[]).some((m) => rank(m, concept) >= 0)) continue;
      for (const [unit, rows] of Object.entries(c.units)) {
        for (const r of rows) {
          if (!r.form || !(ANNUAL_FORMS.test(r.form) || QUARTER_FORMS.test(r.form))) continue;
          const unitName = unit === 'pure' ? 'pure' : unit;
          if (isMoneyUnit(unitName)) {
            const micros = filedMicros(r.val);
            if (micros == null) continue;
            out.push({ concept, value: majorUnitsIfSafe(micros), valueMicros: micros.toString(), unit: unitName, start: r.start ?? null, end: r.end, filed: r.filed ?? null, form: r.form });
          } else {
            out.push({ concept, value: r.val, unit: unitName, start: r.start ?? null, end: r.end, filed: r.filed ?? null, form: r.form });
          }
        }
      }
    }
  }
  return out;
}

// ── ESEF xBRL-JSON (filings.xbrl.org) ────────────────────────────────────────

export interface XbrlJson {
  documentInfo?: unknown;
  facts: Record<string, { value: string | null; decimals?: number; dimensions: Record<string, string> }>;
}

const CORE_DIMS = new Set(['concept', 'entity', 'period', 'unit']);
/** xBRL-JSON period ends are exclusive midnights; turn them into inclusive dates. */
function inclusive(iso: string): string {
  const d = new Date(`${iso.slice(0, 19)}Z`);
  if (iso.slice(11, 19) === '00:00:00') d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function factsFromXbrlJson(doc: XbrlJson, filed: string | null): RawFact[] {
  const out: RawFact[] = [];
  for (const f of Object.values(doc.facts)) {
    const dims = f.dimensions;
    if (Object.keys(dims).some((k) => !CORE_DIMS.has(k))) continue;
    const concept = dims.concept ?? '';
    if (!(Object.keys(CONCEPTS) as FinancialMetric[]).some((m) => rank(m, concept) >= 0)) continue;
    if (f.value == null) continue;
    const period = dims.period ?? '';
    const unit = (dims.unit ?? '').replace(/^iso4217:/, '') || 'pure';
    const [a, b] = period.split('/');
    if (!a) continue;
    const span = b ? { start: a.slice(0, 10), end: inclusive(b) } : { start: null, end: inclusive(a) };
    if (isMoneyUnit(unit)) {
      const micros = filedMicros(f.value);
      if (micros == null) continue;
      out.push({ concept, value: majorUnitsIfSafe(micros), valueMicros: micros.toString(), unit, ...span, filed });
      continue;
    }
    const text = f.value.trim();
    if (/^-?\d+$/.test(text)) {
      const whole = Number(text);
      if (!Number.isSafeInteger(whole)) continue;
      out.push({ concept, value: whole, unit, ...span, filed });
      continue;
    }
    const v = Number(text);
    if (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER) continue;
    out.push({ concept, value: v, unit, ...span, filed });
  }
  return out;
}

/** Narrative text blocks in an ESEF report (notes, policies), for text cues. */
export function textBlocksFromXbrlJson(doc: XbrlJson): Array<{ concept: string; text: string }> {
  const out: Array<{ concept: string; text: string }> = [];
  for (const f of Object.values(doc.facts)) {
    const c = f.dimensions.concept ?? '';
    if (!/(Explanatory|TextBlock)$/.test(c) || typeof f.value !== 'string') continue;
    out.push({ concept: c, text: f.value });
  }
  return out;
}

/** Operating and net margin in % and free cash flow (OCF minus capex), when the inputs exist. */
function microsOf(v: FinancialValue | undefined): bigint | null {
  if (!v) return null;
  if (v.valueMicros && /^-?\d+$/.test(v.valueMicros)) return BigInt(v.valueMicros);
  if (typeof v.value === 'number') return filedMicros(v.value);
  return null;
}

/** One-decimal percent from integer micros. Matches Math.round((part/whole)*1000)/10 for safe amounts. */
function marginFromMicros(part: bigint | null, whole: bigint | null): number | null {
  if (part == null || whole == null || whole <= 0n) return null;
  const half = whole / 2n;
  const scaled = (part * 1000n + (part < 0n ? -half : half)) / whole;
  const n = Number(scaled);
  if (!Number.isSafeInteger(n)) return null;
  return n / 10;
}

export function derived(m: Partial<Record<FinancialMetric, FinancialValue>>): { operatingMargin: number | null; netMargin: number | null; freeCashFlow: number | null } {
  const rev = m.revenue?.value;
  const op = m.operatingIncome?.value;
  const net = m.netIncome?.value;
  const ocf = m.operatingCashFlow?.value;
  const capex = m.capex?.value;
  if (typeof rev === 'number' && (typeof op === 'number' || typeof net === 'number' || (typeof ocf === 'number' && typeof capex === 'number'))) {
    return {
      operatingMargin: rev && op !== undefined && rev > 0 ? Math.round((op / rev) * 1000) / 10 : null,
      netMargin: rev && net !== undefined && rev > 0 ? Math.round((net / rev) * 1000) / 10 : null,
      freeCashFlow: ocf !== undefined && capex !== undefined ? ocf - Math.abs(capex) : null,
    };
  }
  const revMicros = microsOf(m.revenue);
  const flow = microsOf(m.operatingCashFlow);
  const spent = microsOf(m.capex);
  let freeCashFlow: number | null = null;
  if (flow != null && spent != null) {
    const absCapex = spent < 0n ? -spent : spent;
    freeCashFlow = majorUnitsIfSafe(flow - absCapex);
  }
  return {
    operatingMargin: marginFromMicros(microsOf(m.operatingIncome), revMicros),
    netMargin: marginFromMicros(microsOf(m.netIncome), revMicros),
    freeCashFlow,
  };
}
