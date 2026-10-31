/**
 * Financial Watchdog — deterministic classification of public filings.
 *
 * Rules come first and always produce an event; an LLM pass may later rewrite
 * `summary`/`implicationRationale` (summarySource = 'LLM'), never invent events.
 */

export type WatchdogEventKind =
  | 'EARNINGS_RELEASE'
  | 'EARNINGS_DATE'
  | 'ANNUAL_REPORT'
  | 'QUARTERLY_REPORT'
  | 'FILING'
  | 'GUIDANCE_CHANGE'
  | 'M_AND_A'
  | 'RESTRUCTURING'
  | 'LEADERSHIP_CHANGE'
  | 'INSOLVENCY'
  | 'OTHER_DISCLOSURE'
  | 'NEWS_SIGNAL';

export type WatchdogImplication = 'OPPORTUNITY' | 'RISK' | 'NEUTRAL';

export interface Classification {
  kind: WatchdogEventKind;
  implication: WatchdogImplication;
  severity: 1 | 2 | 3 | 4 | 5;
  rationale: string;
}

/** SEC 8-K item codes → classification. Highest-severity item wins. */
const SEC_8K_ITEMS: Record<string, Classification> = {
  '1.01': { kind: 'M_AND_A', implication: 'OPPORTUNITY', severity: 3, rationale: 'Material agreement signed: new programmes or integration work often follow.' },
  '1.03': { kind: 'INSOLVENCY', implication: 'RISK', severity: 5, rationale: 'Bankruptcy or receivership: payment and continuity risk on open work.' },
  '2.01': { kind: 'M_AND_A', implication: 'OPPORTUNITY', severity: 4, rationale: 'Acquisition or disposal completed: integration, carve-out and PMO demand.' },
  '2.02': { kind: 'EARNINGS_RELEASE', implication: 'NEUTRAL', severity: 2, rationale: 'Results published: check guidance and cost programmes before the next call.' },
  '2.05': { kind: 'RESTRUCTURING', implication: 'RISK', severity: 4, rationale: 'Exit or restructuring costs: budget freezes likely; transformation offers may still land.' },
  '2.06': { kind: 'RESTRUCTURING', implication: 'RISK', severity: 3, rationale: 'Material impairment: spending pressure on discretionary projects.' },
  '5.02': { kind: 'LEADERSHIP_CHANGE', implication: 'OPPORTUNITY', severity: 3, rationale: 'Executive change: new decision-makers to meet; sponsor risk on running deals.' },
  '7.01': { kind: 'OTHER_DISCLOSURE', implication: 'NEUTRAL', severity: 1, rationale: 'Regulation FD disclosure: read for guidance changes.' },
  '8.01': { kind: 'OTHER_DISCLOSURE', implication: 'NEUTRAL', severity: 1, rationale: 'Other material event: review.' },
};

export function classifySecFiling(form: string, items: string[] = []): Classification {
  const f = form.toUpperCase().replace(/\/A$/, '');
  if (f === '10-K' || f === '20-F' || f === '40-F') {
    return { kind: 'ANNUAL_REPORT', implication: 'NEUTRAL', severity: 2, rationale: 'Annual report filed: refresh account plan with strategy, risks and capex.' };
  }
  if (f === '10-Q' || f === '6-K') {
    return { kind: 'QUARTERLY_REPORT', implication: 'NEUTRAL', severity: 1, rationale: 'Interim report filed: check revenue trend and guidance.' };
  }
  if (f === '8-K') {
    const hits = items.map((i) => SEC_8K_ITEMS[i.trim()]).filter((c): c is Classification => Boolean(c));
    if (hits.length > 0) return hits.sort((a, b) => b.severity - a.severity)[0]!;
    return { kind: 'OTHER_DISCLOSURE', implication: 'NEUTRAL', severity: 1, rationale: 'Current report filed: review.' };
  }
  if (f === 'SC 13D' || f === 'SC TO-T' || f === 'DEFM14A') {
    return { kind: 'M_AND_A', implication: 'OPPORTUNITY', severity: 4, rationale: 'Ownership or merger filing: change of control likely.' };
  }
  return { kind: 'FILING', implication: 'NEUTRAL', severity: 1, rationale: `Filing ${form} recorded.` };
}

/** Companies House filing-history type codes → classification. */
export function classifyCompaniesHouseFiling(type: string, category = ''): Classification {
  const t = type.toUpperCase();
  if (t === 'AA') return { kind: 'ANNUAL_REPORT', implication: 'NEUTRAL', severity: 2, rationale: 'Annual accounts filed.' };
  if (t === 'AP01' || t === 'AP02' || t === 'TM01' || t === 'TM02') {
    return { kind: 'LEADERSHIP_CHANGE', implication: 'OPPORTUNITY', severity: 2, rationale: 'Officer appointed or terminated: check sponsor map.' };
  }
  if (t.startsWith('LIQ') || t.startsWith('AM') || category.toLowerCase() === 'insolvency') {
    return { kind: 'INSOLVENCY', implication: 'RISK', severity: 5, rationale: 'Insolvency filing: stop new commitments, check receivables.' };
  }
  return { kind: 'FILING', implication: 'NEUTRAL', severity: 1, rationale: `Companies House filing ${type}.` };
}
