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

/** One row of a hiring breakdown: how many roles and their share of the base. */
export interface HiringShare {
  key: string;
  label: string;
  count: number;
  pct: number;
}

/** Drill-down behind the open roles count, for the hiring panel. */
export interface HiringRoleBreakdown {
  /** Function mix over every open role. */
  functions: HiringShare[];
  /** Tech and skills over every open role; a role can name several, so shares do not add up to 100. */
  tech: HiringShare[];
  /** Practice areas the postings point to, counted once per posting. */
  themes: (HiringShare & { theme: InitiativeTheme })[];
  /** Seniority over the postings listed. */
  seniority: HiringShare[];
  /** Postings the theme and seniority shares are read from. */
  postingsBase: number;
}

const share = (count: number, base: number) => (base > 0 ? Math.round((count / base) * 100) : 0);

function rank(counts: Map<string, number>, base: number, label: (k: string) => string): HiringShare[] {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: label(key), count, pct: share(count, base) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Skills a posting names, from its stored skills and its title and department. */
export function postingSkills(p: { title: string; department: string | null; skills: string[] }): string[] {
  return [...new Set([...p.skills, ...extractSkills(`${p.title} ${p.department ?? ''}`)])];
}

/** Shares behind the open roles count: function, tech, practice area and seniority. */
export function hiringBreakdown(
  summary: HiringSummary,
  postings: { title: string; department: string | null; function: string; seniority: string | null; skills: string[] }[],
  themeLabel: (theme: InitiativeTheme) => string,
): HiringRoleBreakdown {
  const open = summary.openRoles;
  const functions = summary.byFunction.map((f) => ({ key: f.key, label: f.label, count: f.count, pct: share(f.count, open) }));
  const tech = summary.skills.map((s) => ({ key: s.skill, label: s.skill, count: s.count, pct: share(s.count, open) }));

  const themeCount = new Map<string, number>();
  const seniorityCount = new Map<string, number>();
  for (const p of postings) {
    const themes = new Set<InitiativeTheme>();
    const fnTheme = FUNCTION_THEME[p.function];
    if (fnTheme) themes.add(fnTheme);
    for (const s of postingSkills(p)) {
      const th = themeForSkill(s);
      if (th) themes.add(th);
    }
    for (const th of themes) themeCount.set(th, (themeCount.get(th) ?? 0) + 1);
    const level = p.seniority?.trim() || 'Not stated';
    seniorityCount.set(level, (seniorityCount.get(level) ?? 0) + 1);
  }
  const themes = rank(themeCount, postings.length, (k) => themeLabel(k as InitiativeTheme)).map((r) => ({ ...r, theme: r.key as InitiativeTheme }));
  const seniority = rank(seniorityCount, postings.length, (k) => k);
  return { functions, tech, themes, seniority, postingsBase: postings.length };
}
