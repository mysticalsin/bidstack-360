/**
 * v23: early-warning rules on filed numbers. Each signal says what changed,
 * why it matters for us, how sure we are, and links the filing it came from.
 * Rules compare the latest annual period with the one before; nothing is
 * guessed when an input is missing.
 */
import { cleanText, type FinancialSignal, type FinancialSignalRule } from '@bidstack/shared';

import { derived, type ExtractedPeriod } from './xbrl.js';

export interface SignalPeriod extends ExtractedPeriod {
  sourceUrl: string;
}

export interface TextCue {
  rule: FinancialSignalRule;
  snippet: string;
  concept: string;
}

/** Watch event kind each rule becomes, so it feeds momentum, timeline and initiatives. */
export const RULE_KIND: Record<FinancialSignalRule, { kind: string; implication: 'OPPORTUNITY' | 'RISK' | 'NEUTRAL' }> = {
  capex_up: { kind: 'STRATEGIC_INITIATIVE', implication: 'OPPORTUNITY' },
  rnd_up: { kind: 'STRATEGIC_INITIATIVE', implication: 'OPPORTUNITY' },
  acquisitions: { kind: 'M_AND_A', implication: 'OPPORTUNITY' },
  margin_squeeze: { kind: 'RESTRUCTURING', implication: 'RISK' },
  restructuring_charge: { kind: 'RESTRUCTURING', implication: 'RISK' },
  debt_jump: { kind: 'OTHER_DISCLOSURE', implication: 'NEUTRAL' },
  impairment: { kind: 'OTHER_DISCLOSURE', implication: 'RISK' },
  guidance_cut: { kind: 'GUIDANCE_CHANGE', implication: 'RISK' },
  text_cue: { kind: 'OTHER_DISCLOSURE', implication: 'NEUTRAL' },
};

const pct = (a: number, b: number) => (b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function fmtMoney(v: number, ccy: string): string {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${r1(a / 1e9)}bn` : a >= 1e6 ? `${r0(a / 1e6)}m` : `${r0(a / 1e3)}k`;
  return `${v < 0 ? '-' : ''}${ccy} ${s}`;
}

const fy = (p: ExtractedPeriod) => `FY${p.periodEnd.slice(0, 4)}`;

export function detectFinancialSignals(periodsIn: SignalPeriod[], cues: TextCue[] = [], cueUrl?: string): FinancialSignal[] {
  const fys = periodsIn.filter((p) => p.periodType === 'FY').sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const out: FinancialSignal[] = [];
  const cur = fys[0];
  const prev = fys[1];
  const push = (rule: FinancialSignalRule, title: string, explanation: string, confidence: FinancialSignal['confidence'], p: SignalPeriod, snippet: string | null = null, url?: string) => {
    out.push({
      id: `${rule}:${p.periodEnd}`,
      rule,
      title,
      explanation,
      confidence,
      implication: RULE_KIND[rule].implication,
      periodEnd: p.periodEnd,
      sourceUrl: url ?? p.sourceUrl,
      snippet,
      sample: false,
    });
  };
  if (cur && prev) {
    const m = cur.metrics;
    const pm = prev.metrics;
    const span = `${fy(cur)} vs ${fy(prev)}`;
    const rev = m.revenue?.value;
    const prevRev = pm.revenue?.value;

    // Capex: spending up a lot, ideally faster than revenue.
    if (m.capex && pm.capex) {
      const c = Math.abs(m.capex.value);
      const pc = Math.abs(pm.capex.value);
      const g = pct(c, pc);
      const share = rev ? (c / rev) * 100 : null;
      const pshare = prevRev ? (pc / prevRev) * 100 : null;
      const shareUp = share !== null && pshare !== null ? share - pshare : null;
      if (g !== null && g >= 25 && (shareUp === null || shareUp >= 0.5)) {
        push(
          'capex_up',
          `Capex up ${r0(g)}%: likely expansion program`,
          `Capital spending rose from ${fmtMoney(pc, prev.currency)} to ${fmtMoney(c, cur.currency)} (${span})${share !== null ? `, now ${r1(share)}% of revenue` : ''}. Big capex jumps usually mean new sites, systems or capacity, which need project and engineering teams.`,
          g >= 50 && (shareUp ?? 0) >= 1 ? 'high' : 'medium',
          cur,
        );
      }
    }

    // R&D: share of revenue rising points at new products.
    if (m.rnd && pm.rnd) {
      const g = pct(m.rnd.value, pm.rnd.value);
      const share = rev ? (m.rnd.value / rev) * 100 : null;
      const pshare = prevRev ? (pm.rnd.value / prevRev) * 100 : null;
      if (g !== null && (g >= 20 || (share !== null && pshare !== null && share - pshare >= 1))) {
        push(
          'rnd_up',
          `R&D up ${r0(g)}%: new product work likely`,
          `R&D spend went from ${fmtMoney(pm.rnd.value, prev.currency)} to ${fmtMoney(m.rnd.value, cur.currency)} (${span})${share !== null ? `, ${r1(share)}% of revenue` : ''}. Rising R&D often comes before launches and engineering hiring.`,
          g >= 30 ? 'high' : 'medium',
          cur,
        );
      }
    }

    // Margin compression, stronger when restructuring charges or cost language appear.
    const dm = derived(m).operatingMargin;
    const pdm = derived(pm).operatingMargin;
    const costCue = cues.find((c) => c.rule === 'restructuring_charge' || c.rule === 'margin_squeeze');
    if (dm !== null && pdm !== null) {
      const drop = pdm - dm;
      const restr = (m.restructuring?.value ?? 0) > 0;
      if (drop >= 3 || (drop >= 2 && (restr || costCue))) {
        push(
          'margin_squeeze',
          `Operating margin down ${r1(drop)} pts`,
          `Operating margin fell from ${r1(pdm)}% to ${r1(dm)}% (${span})${restr ? ' while restructuring charges were booked' : costCue ? ' and the report talks about cost measures' : ''}. Squeezed margins tend to lead to cost programmes, vendor reviews or reorganisation.`,
          restr || costCue ? 'high' : 'medium',
          cur,
          costCue?.snippet ?? null,
        );
      }
    }

    // Restructuring charges booked (new or up sharply).
    if (m.restructuring && m.restructuring.value > 0) {
      const p = pm.restructuring?.value ?? 0;
      const g = p > 0 ? pct(m.restructuring.value, p) : null;
      if (p <= 0 || (g !== null && g >= 50)) {
        push(
          'restructuring_charge',
          p > 0 ? `Restructuring charges up ${r0(g ?? 0)}%` : 'Restructuring charges booked',
          `${fmtMoney(m.restructuring.value, cur.currency)} of restructuring costs in ${fy(cur)}${p > 0 ? ` against ${fmtMoney(p, prev.currency)} a year earlier` : ''}. Expect reorganisation, site changes or headcount moves.`,
          'high',
          cur,
        );
      }
    }

    // Debt or leverage jump.
    if (m.debt && pm.debt && pm.debt.value > 0) {
      const g = pct(m.debt.value, pm.debt.value);
      if (g !== null && g >= 30) {
        push(
          'debt_jump',
          `Debt up ${r0(g)}%: new funding or refinancing`,
          `Borrowings went from ${fmtMoney(pm.debt.value, prev.currency)} to ${fmtMoney(m.debt.value, cur.currency)} (${span}). Fresh debt usually funds an acquisition, a build-out or a refinancing; ask which.`,
          g >= 60 ? 'high' : 'medium',
          cur,
        );
      }
    }

    // Acquisitions paid for in the year.
    if (m.acquisitions && rev) {
      const a = Math.abs(m.acquisitions.value);
      if (a / rev >= 0.05) {
        push(
          'acquisitions',
          `Spent ${fmtMoney(a, cur.currency)} on acquisitions`,
          `Cash paid to buy businesses in ${fy(cur)} was ${r1((a / rev) * 100)}% of revenue. Integration work (systems, processes, people) usually follows for 12 to 24 months.`,
          a / rev >= 0.15 ? 'high' : 'medium',
          cur,
        );
      }
    }
  }

  // Impairments: material write-downs in the latest year.
  if (cur?.metrics.impairment && cur.metrics.impairment.value > 0) {
    const v = cur.metrics.impairment.value;
    const rev = cur.metrics.revenue?.value;
    if (!rev || v / rev >= 0.01) {
      push(
        'impairment',
        `Impairment of ${fmtMoney(v, cur.currency)}`,
        `The company wrote down assets in ${fy(cur)}${rev ? ` (${r1((v / rev) * 100)}% of revenue)` : ''}. Write-downs often precede exits, disposals or a strategy reset.`,
        rev && v / rev >= 0.05 ? 'high' : 'medium',
        cur,
      );
    }
  }

  // Text cues from the narrative notes (guidance cuts, programmes, plants, M&A).
  const seen = new Set(out.map((s) => s.rule));
  for (const c of cues) {
    if (!cur) break;
    const rule = c.rule === 'margin_squeeze' || c.rule === 'restructuring_charge' ? (seen.has('margin_squeeze') ? null : 'text_cue') : c.rule;
    if (!rule || seen.has(rule)) continue;
    seen.add(rule);
    const title = CUE_TITLE[c.rule] ?? 'Filing language to watch';
    push(rule, title, `${CUE_WHY[c.rule] ?? 'The annual report uses language worth a conversation.'} Quote from the ${fy(cur)} report.`, 'low', cur, c.snippet, cueUrl);
  }
  const order = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => order[a.confidence] - order[b.confidence]);
}

const CUE_TITLE: Partial<Record<FinancialSignalRule, string>> = {
  guidance_cut: 'Outlook lowered in the report',
  restructuring_charge: 'Cost programme mentioned in the report',
  margin_squeeze: 'Cost programme mentioned in the report',
  capex_up: 'New site or capacity mentioned in the report',
  acquisitions: 'Acquisition mentioned in the report',
};
const CUE_WHY: Partial<Record<FinancialSignalRule, string>> = {
  guidance_cut: 'Lower guidance usually means budget freezes or a cost review.',
  restructuring_charge: 'A named cost or transformation programme usually means reorganisation work.',
  margin_squeeze: 'A named cost or transformation programme usually means reorganisation work.',
  capex_up: 'New plants, sites or capacity need project, engineering and staffing support.',
  acquisitions: 'Deals bring integration work for systems, processes and people.',
};

// Patterns run on a squashed copy of the text (lowercase, no whitespace),
// because iXBRL text blocks converted from PDF often split words ("acquisitio n").
// English plus the filing languages of the demo accounts (es, pt, no).
const CUE_RULES: Array<{ rule: FinancialSignalRule; re: RegExp }> = [
  { rule: 'guidance_cut', re: /(lower(ed|s)?|cut|reduc(ed|es)|revis(ed|es)down(ward)?)(our|its|the|full-?year|annual){0,2}(guidance|outlook|forecast)|(guidance|outlook)(was|has been|is)?(lowered|cut|reduced|reviseddown)/ },
  { rule: 'restructuring_charge', re: /restructuring(plan|programme|program)|transformation(plan|programme|program)|cost-?(reduction|saving|efficiency)(plan|programme|program|initiative)|efficiencyprogramme|headcountreduction|redundanc(y|ies)programme|plande(reestructuraci[oó]n|transformaci[oó]n|eficiencia)|programadereestrutura[cç][aã]o|omstillingsprogram|kostnadsprogram/ },
  { rule: 'capex_up', re: /new(plant|factory|facility|datacent(er|re)|distributioncent(er|re)|headquarters)|capacityexpansion|expansion(plan|programme|program)|investment(plan|programme|program)of|nuevaplanta|novaf[aá]brica/ },
  { rule: 'acquisitions', re: /completedtheacquisitionof|agreedtoacquire|acquiredtheentiresharecapitalof|acquired(\d{2,3}(\.\d+)?|all|amajority)(%|percent|ofthe(shares|sharecapital))|acquisitionof.{2,60}?was(completed|concluded)|complet[oó]laadquisici[oó]nde|concluiuaaquisi[cç][aã]o|gjennomf[oø]rtkj[oø]pet?av/ },
];

/** Find cue sentences in narrative text blocks; one snippet per rule. Tables (mostly digits) are skipped. */
export function findTextCues(blocks: Array<{ concept: string; text: string }>, maxLen = 260): TextCue[] {
  const out: TextCue[] = [];
  const have = new Set<FinancialSignalRule>();
  for (const b of blocks) {
    // accounting-policy and standards notes are boilerplate, not company news
    if (/AccountingPolic|NewStandards|NewIFRS|ChangesInAccounting|BasisOfPreparation/i.test(b.concept)) continue;
    const text = cleanText(b.text);
    if (!text) continue;
    // squashed text with a map back to the original offsets
    let sq = '';
    const at: number[] = [];
    for (let k = 0; k < text.length; k++) {
      const c = text[k]!;
      if (/\s/.test(c)) continue;
      sq += c.toLowerCase();
      at.push(k);
    }
    for (const { rule, re } of CUE_RULES) {
      if (have.has(rule)) continue;
      const g = new RegExp(re.source, 'g');
      for (let m = g.exec(sq); m; m = g.exec(sq)) {
        const from = at[m.index]!;
        const to = (at[m.index + m[0].length - 1] ?? from) + 1;
        const snippet = sentenceAround(text, from, to, maxLen);
        if (!snippet) continue;
        out.push({ rule, snippet, concept: b.concept });
        have.add(rule);
        break;
      }
    }
  }
  return out;
}

/** The sentence around a match, trimmed to maxLen, or null when it reads like a table. */
export function sentenceAround(text: string, from: number, to: number, maxLen = 260): string | null {
  const before = text.slice(Math.max(0, from - 200), from);
  const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '));
  const start = cut === -1 ? Math.max(0, from - 120) : Math.max(0, from - 200) + cut + 2;
  const after = text.slice(to, to + 200);
  const stop = after.search(/[.;](\s|$)/);
  const end = stop === -1 ? Math.min(text.length, to + 120) : to + stop + 1;
  let s = text.slice(start, end).trim();
  if (s.length < 30) return null;
  const digits = (s.match(/\d/g) ?? []).length;
  if (digits / s.length > 0.15) return null;
  if (s.length > maxLen) s = `${s.slice(0, maxLen - 3).trim()}...`;
  return (start > 0 && cut === -1 ? '...' : '') + s;
}
