import type { InitiativeTheme } from '../schemas/account-signals.js';
import { extractSkills, themeForSkill } from './skills.js';
import type { HiringSummary } from './types.js';

const DAY = 86_400_000;
/** A posting counts as open when it was seen (or posted) within this window. */
export const OPEN_ROLE_WINDOW_DAYS = 45;

/** Minimal posting shape the hiring summary reads. */
export interface HiringPostingInput {
  id: string;
  title: string;
  function: string;
  department: string | null;
  skills: string[];
  postedAt: Date | string | null;
  lastSeenAt: Date | string | null;
  source: string;
  url: string | null;
}

/** Hiring summary plus the evidence ids of the postings it was built from. */
export interface HiringInput {
  summary: HiringSummary;
  evidenceIds: string[];
}

/** Display label per job function key. */
export const FUNCTION_LABEL: Record<string, string> = {
  data: 'Data',
  ml_ai: 'AI and ML',
  engineering: 'Engineering',
  infrastructure: 'Cloud and infra',
  security: 'Security',
  product: 'Product',
  design: 'Design',
  sales: 'Sales',
  marketing: 'Marketing',
  customer_success: 'Customer success',
  finance: 'Finance',
  people: 'People',
  operations: 'Operations',
  legal: 'Legal',
  other: 'Other',
};

/** Theme a job function points to, when it points to one. */
export const FUNCTION_THEME: Record<string, InitiativeTheme | undefined> = {
  data: 'data_ai',
  ml_ai: 'data_ai',
  infrastructure: 'cloud',
  security: 'cyber',
  engineering: 'engineering',
  product: 'digital_cx',
  design: 'digital_cx',
  finance: 'erp_finance',
  legal: 'regulatory',
};

function ms(v: Date | string | null): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function pct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Open roles, 30 and 90 day posting trend, function mix and skills keywords. */
export function summarizeHiring(postings: HiringPostingInput[], now: Date = new Date()): HiringSummary {
  const t = now.getTime();
  const age = (v: Date | string | null): number | null => {
    const x = ms(v);
    return x == null ? null : (t - x) / DAY;
  };
  const within = (a: number | null, from: number, to: number) => a != null && a >= from && a < to;

  const open = postings.filter((p) => {
    const seen = age(p.lastSeenAt) ?? age(p.postedAt);
    return seen != null && seen <= OPEN_ROLE_WINDOW_DAYS;
  });
  const ages = postings.map((p) => age(p.postedAt));
  const count = (from: number, to: number) => ages.filter((a) => within(a, from, to)).length;
  const posted30 = count(0, 30);
  const postedPrev30 = count(30, 60);
  const posted90 = count(0, 90);
  const postedPrev90 = count(90, 180);
  const monthly = [5, 4, 3, 2, 1, 0].map((i) => count(i * 30, (i + 1) * 30));

  const base = open.length ? open : [];
  const fnCount = new Map<string, number>();
  for (const p of base) fnCount.set(p.function, (fnCount.get(p.function) ?? 0) + 1);
  const byFunction = [...fnCount.entries()]
    .map(([key, n]) => ({ key, label: FUNCTION_LABEL[key] ?? key, count: n }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const skillCount = new Map<string, number>();
  for (const p of base) {
    const set = new Set([...p.skills, ...extractSkills(`${p.title} ${p.department ?? ''}`)]);
    for (const s of set) skillCount.set(s, (skillCount.get(s) ?? 0) + 1);
  }
  const skills = [...skillCount.entries()]
    .map(([skill, n]) => ({ skill, count: n, theme: themeForSkill(skill) }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, 20);

  return {
    openRoles: open.length,
    posted30,
    postedPrev30,
    posted90,
    postedPrev90,
    trend30Pct: pct(posted30, postedPrev30),
    trend90Pct: pct(posted90, postedPrev90),
    monthly,
    byFunction,
    skills,
    sources: [...new Set(postings.map((p) => p.source))].sort(),
  };
}

/** Themes the open roles point to, with the number of roles behind each. */
export function hiringThemes(summary: HiringSummary): Map<InitiativeTheme, number> {
  const out = new Map<InitiativeTheme, number>();
  for (const f of summary.byFunction) {
    const th = FUNCTION_THEME[f.key];
    if (th) out.set(th, (out.get(th) ?? 0) + f.count);
  }
  for (const s of summary.skills) if (s.theme) out.set(s.theme, Math.max(out.get(s.theme) ?? 0, s.count));
  return out;
}
