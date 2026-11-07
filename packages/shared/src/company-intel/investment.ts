import { OFFERING_HOOKS, type InitiativeTheme } from '../schemas/account-signals.js';
import { hiringThemes, type HiringInput } from './hiring.js';
import { classifyPost } from './posts.js';
import type { StatementInput } from './statements.js';
import type { IntelFinancialYear, IntelPost, InvestmentThemeItem } from './types.js';

/** One fiscal year of figures as the plan reads it. */
export type FinancialYearInput = IntelFinancialYear;

/** Where they invest, where they cut, and the inferred next 12 months. */
export interface InvestmentPlan {
  investing: InvestmentThemeItem[];
  cutting: InvestmentThemeItem[];
  next12: InvestmentThemeItem[];
}

/** Inputs to the investment plan. Every input carries its own evidence ids. */
export interface InvestmentPlanInput {
  years: FinancialYearInput[];
  statements: StatementInput[];
  hiring: HiringInput | null;
  posts: IntelPost[];
}

type Metric = 'capex' | 'rnd' | 'acquisitions' | 'intangibles' | 'debtIssued' | 'headcount' | 'restructuring';

const METRIC_LABEL: Record<Metric, string> = {
  capex: 'Capex',
  rnd: 'R&D',
  acquisitions: 'Acquisitions',
  intangibles: 'Software and intangibles',
  debtIssued: 'Debt raised',
  headcount: 'Headcount',
  restructuring: 'Restructuring',
};

const METRIC_THEME: Partial<Record<Metric, InitiativeTheme>> = {
  rnd: 'engineering',
  acquisitions: 'm_and_a',
  intangibles: 'digital_cx',
  restructuring: 'workforce',
};

/** Changes smaller than this read as steady rather than a move. */
const STEADY_PCT = 5;

/** Compact number for copy: 1.2bn, 340m, 12k. */
export function compactAmount(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}bn`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}m`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

function money(n: number, currency: string | null): string {
  return currency ? `${compactAmount(n)} ${currency}` : compactAmount(n);
}

function trend(cur: number, prev: number | null): number | null {
  if (prev == null || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

function metricLines(years: FinancialYearInput[]): { investing: InvestmentThemeItem[]; cutting: InvestmentThemeItem[] } {
  const investing: InvestmentThemeItem[] = [];
  const cutting: InvestmentThemeItem[] = [];
  const sorted = [...years].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const latest = sorted.at(-1);
  if (!latest) return { investing, cutting };
  const prev = sorted.length > 1 ? sorted.at(-2)! : null;

  const metrics: Metric[] = ['capex', 'rnd', 'intangibles', 'acquisitions', 'debtIssued', 'headcount', 'restructuring'];
  for (const m of metrics) {
    const cur = latest[m];
    if (cur == null) continue;
    const before = prev?.[m] ?? null;
    const t = trend(cur, before);
    const ids = before != null && prev ? [latest.evidenceId, prev.evidenceId] : [latest.evidenceId];
    const fy = `FY${latest.fiscalYear}`;
    const vs = prev ? ` vs FY${prev.fiscalYear}` : '';
    const isCount = m === 'headcount';
    const amountText = isCount ? `${compactAmount(cur)} people` : money(cur, latest.currency);
    const base = { id: `fin-${m}-${latest.fiscalYear}`, area: m, theme: METRIC_THEME[m] ?? null, label: METRIC_LABEL[m], amount: cur, currency: isCount ? null : latest.currency, trendPct: t, basis: 'observed' as const, evidenceIds: ids };

    if (m === 'restructuring') {
      if (cur > 0) cutting.push({ ...base, direction: 'cutting', summary: `Restructuring charges of ${amountText} in ${fy}` });
      continue;
    }
    if (m === 'acquisitions' || m === 'debtIssued') {
      if (cur > 0) {
        const verb = m === 'acquisitions' ? 'Spent' : 'Raised';
        investing.push({ ...base, direction: 'investing', summary: `${verb} ${amountText} on ${m === 'acquisitions' ? 'acquisitions' : 'new debt'} in ${fy}${t != null ? `, ${t >= 0 ? 'up' : 'down'} ${Math.abs(t)}%${vs}` : ''}` });
      }
      continue;
    }
    const ratio = m === 'capex' && latest.revenue ? ` (${((cur / latest.revenue) * 100).toFixed(1)}% of revenue)` : '';
    if (t != null && t <= -STEADY_PCT) {
      cutting.push({ ...base, direction: 'cutting', summary: `${METRIC_LABEL[m]} down ${Math.abs(t)}% to ${amountText}${ratio} in ${fy}${vs}` });
    } else if (!isCount || (t != null && t >= STEADY_PCT)) {
      const move = t == null ? '' : t >= STEADY_PCT ? `, up ${t}%${vs}` : `, steady${vs}`;
      investing.push({ ...base, direction: 'investing', summary: `${METRIC_LABEL[m]} ${amountText}${ratio} in ${fy}${move}` });
    }
  }
  return { investing, cutting };
}

function postTheme(p: IntelPost): InitiativeTheme | null {
  return classifyPost(p.title).theme;
}

/**
 * Reverse-engineered investment plan. Investing and cutting lines are read
 * from filed facts and quoted filing text. The next 12 months are inferred
 * only for themes backed by at least two independent kinds of evidence.
 * Callers pass only recent posts.
 */
export function buildInvestmentPlan(input: InvestmentPlanInput): InvestmentPlan {
  const { investing, cutting } = metricLines(input.years);

  input.statements.forEach((s, i) => {
    const line: InvestmentThemeItem = {
      id: `stmt-${i}`,
      direction: s.stance === 'cut' ? 'cutting' : 'investing',
      area: s.stance === 'guidance' ? 'guidance' : 'stated',
      theme: s.theme,
      label: s.theme ? OFFERING_HOOKS[s.theme].label : s.stance === 'guidance' ? 'Guidance' : 'Stated priority',
      amount: null,
      currency: null,
      trendPct: null,
      basis: 'stated',
      summary: s.text,
      evidenceIds: [s.evidenceId],
    };
    (line.direction === 'cutting' ? cutting : investing).push(line);
  });

  const kinds = new Map<InitiativeTheme, Map<string, Set<string>>>();
  const add = (theme: InitiativeTheme | null, kind: string, ids: string[]) => {
    if (!theme || !ids.length) return;
    const k = kinds.get(theme) ?? new Map<string, Set<string>>();
    const set = k.get(kind) ?? new Set<string>();
    for (const id of ids) set.add(id);
    k.set(kind, set);
    kinds.set(theme, k);
  };
  for (const s of input.statements) if (s.stance !== 'cut') add(s.theme, 'filing text', [s.evidenceId]);
  if (input.hiring && input.hiring.summary.openRoles > 0) {
    for (const [th] of hiringThemes(input.hiring.summary)) add(th, 'open roles', input.hiring.evidenceIds);
  }
  for (const p of input.posts) {
    add(postTheme(p), p.origin === 'own' ? 'company posts' : 'news', [p.evidenceId]);
  }
  for (const line of investing) if (line.basis === 'observed' && line.theme && (line.trendPct ?? 0) >= STEADY_PCT) add(line.theme, 'filed figures', line.evidenceIds);

  const next12: InvestmentThemeItem[] = [...kinds.entries()]
    .filter(([, k]) => k.size >= 2)
    .map(([theme, k]) => {
      const ids = [...new Set([...k.values()].flatMap((s) => [...s]))];
      return { theme, k, ids };
    })
    .sort((a, b) => b.k.size - a.k.size || b.ids.length - a.ids.length || a.theme.localeCompare(b.theme))
    .slice(0, 5)
    .map(({ theme, k, ids }) => ({
      id: `next12-${theme}`,
      direction: 'next12' as const,
      area: 'theme',
      theme,
      label: OFFERING_HOOKS[theme].label,
      amount: null,
      currency: null,
      trendPct: null,
      basis: 'inferred' as const,
      summary: `Inferred from ${[...k.keys()].join(', ')}`,
      evidenceIds: ids,
    }));

  return { investing, cutting, next12 };
}
