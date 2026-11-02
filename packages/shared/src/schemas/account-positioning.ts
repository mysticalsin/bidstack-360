/**
 * Account positioning (v24): "What to position" plays, a deterministic account
 * brief, gaps and risks, and the key-numbers strip at the top of the cockpit.
 *
 * Everything here is computed from data Polo already holds (initiatives,
 * filed financials, watchdog events, org chart, contacts, meetings, pipeline).
 * Nothing is invented: a value with no source is omitted, never estimated.
 */
import { z } from 'zod';

import { OFFERING_HOOKS, type Initiative, type InitiativeTheme, InitiativeTheme as InitiativeThemeSchema } from './account-signals.js';

const Iso = z.string();
const Confidence = z.enum(['high', 'medium', 'low']);

// ── contracts ───────────────────────────────────────────────────────────────

export const EvidenceChipKind = z.enum(['financial', 'hiring', 'initiative', 'news', 'funding', 'launch', 'filing', 'meeting']);
export type EvidenceChipKind = z.infer<typeof EvidenceChipKind>;

export const EvidenceChip = z.object({
  kind: EvidenceChipKind,
  label: z.string(),
  /** External evidence (filing, article, job post). */
  url: z.string().nullable(),
  /** In-page section that holds the signal, e.g. "financial-health". */
  anchor: z.string(),
  at: Iso.nullable(),
  source: z.string(),
  sample: z.boolean(),
});
export type EvidenceChip = z.infer<typeof EvidenceChip>;

export const ApproachPerson = z.object({
  name: z.string(),
  title: z.string().nullable(),
  seniority: z.enum(['c_level', 'vp', 'director', 'manager', 'ic', 'unknown']),
  met: z.boolean(),
  lastMetAt: Iso.nullable(),
  /** Why this person: role fit or seniority. */
  why: z.string(),
  source: z.enum(['org_chart', 'contact', 'meeting']),
});
export type ApproachPerson = z.infer<typeof ApproachPerson>;

export const DealRange = z.object({
  lowMicros: z.string(),
  highMicros: z.string(),
  basis: z.string(),
  deals: z.number().int(),
});
export type DealRange = z.infer<typeof DealRange>;

export const PositioningPlay = z.object({
  rank: z.number().int(),
  theme: InitiativeThemeSchema,
  themeLabel: z.string(),
  offering: z.string(),
  headline: z.string(),
  whyNow: z.array(EvidenceChip),
  approach: z.array(ApproachPerson),
  /** Shown when no fitting person is known yet. */
  approachGap: z.string().nullable(),
  talkingPoints: z.array(z.string()),
  firstStep: z.string(),
  confidence: Confidence,
  confidenceScore: z.number(),
  alreadySold: z.boolean(),
  /** Only when derived from won deals in the pipeline; otherwise null. */
  dealRange: DealRange.nullable(),
  sample: z.boolean(),
});
export type PositioningPlay = z.infer<typeof PositioningPlay>;

export const BriefFacts = z.object({
  name: z.string(),
  tierLabel: z.string(),
  industry: z.string().nullable(),
  country: z.string().nullable(),
  employees: z.object({ value: z.number(), source: z.string() }).nullable(),
  momentum: z.object({ score: z.number(), delta: z.number(), trend: z.enum(['gaining', 'steady', 'declining']), sample: z.boolean() }).nullable(),
  financials: z
    .object({
      fiscalYear: z.number().int(),
      source: z.string(),
      currency: z.string(),
      revenue: z.number().nullable(),
      revenueYoY: z.number().nullable(),
      marginLabel: z.string().nullable(),
      margin: z.number().nullable(),
      marginDelta: z.number().nullable(),
      stale: z.boolean(),
    })
    .nullable(),
  pipeline: z.object({ openCount: z.number().int(), openMicros: z.string(), won24m: z.number().int(), lost24m: z.number().int() }),
  people: z.object({ known: z.number().int(), senior: z.number().int(), metLast12m: z.number().int(), lastMeeting: z.object({ at: Iso, title: z.string() }).nullable() }),
  topSignal: z.object({ title: z.string(), at: Iso.nullable(), source: z.string(), sample: z.boolean() }).nullable(),
});
export type BriefFacts = z.infer<typeof BriefFacts>;

export const GapKind = z.enum(['senior_contacts', 'no_recent_meeting', 'declining_momentum', 'restructuring', 'competitor', 'no_pipeline', 'stale_data', 'leadership_change']);
export const AccountGap = z.object({
  kind: GapKind,
  severity: z.enum(['high', 'medium', 'low']),
  title: z.string(),
  detail: z.string(),
  evidence: z.array(EvidenceChip),
});
export type AccountGap = z.infer<typeof AccountGap>;

export const AccountPositioning = z.object({
  companyId: z.string(),
  plays: z.array(PositioningPlay),
  brief: BriefFacts,
  gaps: z.array(AccountGap),
  /** True when every play rests on demo data only. */
  sample: z.boolean(),
  computedAt: Iso,
});
export type AccountPositioning = z.infer<typeof AccountPositioning>;

export const KeyNumberUnit = z.enum(['count', 'money', 'money_micros', 'pct', 'score', 'days', 'sentiment']);
export const KeyNumber = z.object({
  id: z.string(),
  group: z.enum(['company', 'health']),
  label: z.string(),
  /** null = no data; the UI shows the reason instead of a number. */
  value: z.number().nullable(),
  /**
   * Exact integer micros for a money_micros value. The number loses cents
   * once the micros integer passes 2^53.
   */
  valueMicros: z.string().regex(/^\d+$/).optional(),
  unit: KeyNumberUnit,
  currency: z.string().nullable(),
  /** Change over the stated period, in deltaUnit. */
  delta: z.number().nullable(),
  deltaUnit: z.enum(['pct', 'pts', 'abs']).nullable(),
  /** Which direction is good for a seller; colour follows direction only. */
  goodWhen: z.enum(['up', 'down']),
  series: z.array(z.number()),
  /** Short secondary line, e.g. "of 4 senior contacts". */
  sub: z.string().nullable(),
  source: z.string(),
  period: z.string(),
  sourceUrl: z.string().nullable(),
  anchor: z.string().nullable(),
  missing: z.string().nullable(),
  sample: z.boolean(),
});
export type KeyNumber = z.infer<typeof KeyNumber>;

export const AccountKeyNumbers = z.object({ companyId: z.string(), items: z.array(KeyNumber), computedAt: Iso });
export type AccountKeyNumbers = z.infer<typeof AccountKeyNumbers>;

// ── people ──────────────────────────────────────────────────────────────────

export type Seniority = ApproachPerson['seniority'];

/** Seniority from a free-text title (contacts carry a role, not a level). */
export function seniorityFromTitle(title: string | null | undefined): Seniority {
  const t = ` ${(title ?? '').toLowerCase()} `;
  if (!t.trim()) return 'unknown';
  if (/\b(chief|ceo|cfo|cio|cto|coo|cdo|ciso|chro|cmo|president|founder|managing director|general manager|board|chair)\b/.test(t)) return 'c_level';
  if (/\b(vp|vice president|svp|evp|head of|group head)\b/.test(t)) return 'vp';
  if (/\b(director|diretor|directeur|direktør)\b/.test(t)) return 'director';
  if (/\b(manager|lead|gerente|responsable)\b/.test(t)) return 'manager';
  return 'ic';
}

export const SENIOR: ReadonlySet<Seniority> = new Set(['c_level', 'vp']);

const ROLE_FIT: Record<InitiativeTheme, { re: RegExp; role: string }> = {
  data_ai: { re: /\b(data|analytics|ai\b|cdo|insight|bi\b|cio|cto|information|digital)/i, role: 'Chief Data Officer or Head of Data' },
  cloud: { re: /\b(cloud|infrastructure|it\b|cio|cto|information|technology|platform|operations)/i, role: 'CIO or Head of Infrastructure' },
  cyber: { re: /\b(security|ciso|cyber|risk|cio|information security)/i, role: 'CISO' },
  digital_cx: { re: /\b(digital|customer|marketing|product|experience|cmo|cdo|e-?commerce)/i, role: 'Chief Digital Officer or Head of Product' },
  erp_finance: { re: /\b(financ|cfo|controller|erp|accounting|treasury|transformation)/i, role: 'CFO or Head of Finance Transformation' },
  engineering: { re: /\b(engineering|r&d|cto|research|manufactur|plant|operations|technical)/i, role: 'CTO or Head of Engineering' },
  expansion: { re: /\b(ceo|coo|strategy|growth|managing director|general manager|country)/i, role: 'COO or Head of Strategy' },
  m_and_a: { re: /\b(m&a|corporate development|strategy|integration|cfo|transformation)/i, role: 'Head of Corporate Development or Integration' },
  regulatory: { re: /\b(compliance|risk|legal|regulat|cro\b|audit)/i, role: 'Chief Risk or Compliance Officer' },
  workforce: { re: /\b(hr\b|people|talent|chro|human|workforce|coo|transformation)/i, role: 'CHRO or Head of Transformation' },
};

export function roleFor(theme: InitiativeTheme): string {
  return ROLE_FIT[theme].role;
}

export interface KnownPerson {
  name: string;
  title: string | null;
  seniority: Seniority;
  met: boolean;
  lastMetAt: string | null;
  source: ApproachPerson['source'];
}

const SEN_WEIGHT: Record<Seniority, number> = { c_level: 3, vp: 2.5, director: 2, manager: 1, ic: 0.5, unknown: 0.5 };
const DAY = 86_400_000;

/** Up to two people to approach for a theme: role fit first, then seniority, then who we met recently. */
export function pickApproach(theme: InitiativeTheme, people: KnownPerson[], now: Date): { approach: ApproachPerson[]; gap: string | null } {
  const fit = ROLE_FIT[theme];
  const scored = people.map((p) => {
    const fits = fit.re.test(p.title ?? '');
    const recent = p.met && p.lastMetAt ? Math.max(0, 1 - (now.getTime() - Date.parse(p.lastMetAt)) / (365 * DAY)) : 0;
    return { p, fits, score: (fits ? 4 : 0) + SEN_WEIGHT[p.seniority] + (p.met ? 1 : 0) + recent };
  });
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
  const pick = scored.filter((s) => s.fits || SENIOR.has(s.p.seniority)).slice(0, 2);
  const approach = pick.map(({ p, fits }) => ({
    name: p.name,
    title: p.title,
    seniority: p.seniority,
    met: p.met,
    lastMetAt: p.lastMetAt,
    why: fits ? `Owns the ${OFFERING_HOOKS[theme].label.toLowerCase()} agenda` : 'Senior sponsor',
    source: p.source,
  }));
  const gap = pick.some((s) => s.fits) ? null : `No ${fit.role} known yet. Map this role in the org chart.`;
  return { approach, gap };
}

// ── plays ───────────────────────────────────────────────────────────────────

/** Lower-case a label but keep acronyms (M&A, ERP, R&D, AI) as written. */
export function lowerLabel(label: string): string {
  return label.split(' ').map((w) => (/[A-Z].*[A-Z&]|^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
}

/** "financial_services" becomes "financial services". */
export function humanIndustry(v: string): string {
  return /_/.test(v) ? v.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() : v;
}

/** Which offering a filed-financials signal points to. */
export const FINANCIAL_RULE_THEME: Partial<Record<string, InitiativeTheme>> = {
  margin_squeeze: 'erp_finance',
  restructuring_charge: 'workforce',
  guidance_cut: 'workforce',
  debt_jump: 'erp_finance',
  impairment: 'erp_finance',
  acquisitions: 'm_and_a',
  capex_up: 'engineering',
  rnd_up: 'engineering',
};

export interface FinancialSignalLite {
  rule: string;
  title: string;
  confidence: 'high' | 'medium' | 'low';
  periodEnd: string;
  sourceUrl: string;
  sample: boolean;
}

export interface WonDeal {
  name: string;
  valueMicros: bigint;
  /** Won at this account (true) or elsewhere in the org (false). */
  here: boolean;
}

const pct = (sorted: bigint[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;

/**
 * Expected deal size, only from won deals: the org's won deals on the same
 * theme (3 or more, middle half), else this account's own wins (2 or more,
 * min to max). Otherwise null: no range is shown.
 */
export function dealRangeFor(theme: InitiativeTheme, won: WonDeal[], themeOf: (name: string) => InitiativeTheme): DealRange | null {
  const label = OFFERING_HOOKS[theme].label;
  const onTheme = won.filter((w) => w.valueMicros > 0n && themeOf(w.name) === theme).map((w) => w.valueMicros).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (onTheme.length >= 3) {
    return { lowMicros: pct(onTheme, 0.25).toString(), highMicros: pct(onTheme, 0.75).toString(), basis: `Middle half of ${onTheme.length} won ${label} deals in your pipeline`, deals: onTheme.length };
  }
  const here = won.filter((w) => w.here && w.valueMicros > 0n).map((w) => w.valueMicros).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (here.length >= 2) {
    return { lowMicros: here[0]!.toString(), highMicros: here[here.length - 1]!.toString(), basis: `Range of ${here.length} deals won at this account`, deals: here.length };
  }
  return null;
}

const ANCHOR: Record<EvidenceChipKind, string> = {
  financial: 'financial-health',
  hiring: 'hiring-now',
  initiative: 'initiatives',
  news: 'watchdog',
  funding: 'watchdog',
  launch: 'watchdog',
  filing: 'watchdog',
  meeting: 'who-we-met',
};
export const anchorFor = (k: EvidenceChipKind) => ANCHOR[k];

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthYear = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? '' : `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const CONF_SCORE = { high: 0.6, medium: 0.45, low: 0.3 } as const;
const label = (s: number): PositioningPlay['confidence'] => (s >= 0.75 ? 'high' : s >= 0.5 ? 'medium' : 'low');

export interface PlayInputs {
  initiatives: Initiative[];
  financialSignals: FinancialSignalLite[];
  financialSource: string | null;
  people: KnownPerson[];
  won: WonDeal[];
  themeOf: (name: string) => InitiativeTheme;
  now: Date;
}

/** Rank up to three plays from initiatives plus filed-financials signals. */
export function buildPlays(input: PlayInputs): PositioningPlay[] {
  type Draft = { theme: InitiativeTheme; headline: string; score: number; chips: EvidenceChip[]; alreadySold: boolean; sample: boolean; rationale: string };
  const drafts = new Map<InitiativeTheme, Draft>();
  for (const it of input.initiatives) {
    const chips: EvidenceChip[] = it.evidence.slice(0, 4).map((e) => ({
      kind: e.kind,
      label: e.title.length > 90 ? `${e.title.slice(0, 87).trim()}...` : e.title,
      url: e.url,
      anchor: ANCHOR[e.kind],
      at: e.at,
      source: e.source,
      sample: e.sample,
    }));
    chips.push({ kind: 'initiative', label: it.title, url: null, anchor: ANCHOR.initiative, at: it.lastSeen, source: 'Initiatives board', sample: it.sample });
    drafts.set(it.theme, { theme: it.theme, headline: it.title, score: it.confidenceScore, chips, alreadySold: it.hook.alreadySold, sample: it.sample, rationale: it.rationale });
  }
  for (const s of input.financialSignals) {
    const theme = FINANCIAL_RULE_THEME[s.rule];
    if (!theme) continue;
    const chip: EvidenceChip = { kind: 'financial', label: s.title, url: s.sourceUrl || null, anchor: ANCHOR.financial, at: s.periodEnd, source: input.financialSource ?? 'Filed financials', sample: s.sample };
    const d = drafts.get(theme);
    if (d) {
      d.chips.unshift(chip);
      d.score = Math.min(0.95, d.score + 0.1);
      if (!s.sample) d.sample = false;
    } else {
      drafts.set(theme, { theme, headline: s.title, score: CONF_SCORE[s.confidence], chips: [chip], alreadySold: false, sample: s.sample, rationale: s.title });
    }
  }
  const plays = [...drafts.values()].map((d) => {
    const hook = OFFERING_HOOKS[d.theme];
    const { approach, gap } = pickApproach(d.theme, input.people, input.now);
    let score = d.score;
    if (approach.some((p) => p.met && p.lastMetAt && input.now.getTime() - Date.parse(p.lastMetAt) < 180 * DAY)) score += 0.05;
    if (d.alreadySold) score -= 0.05;
    score = Math.round(Math.min(0.95, Math.max(0.05, score)) * 100) / 100;
    const lead = d.chips.find((c) => c.kind !== 'initiative') ?? d.chips[0];
    const points: string[] = [];
    if (lead) points.push(`${lead.label}${lead.at ? ` (${monthYear(lead.at)}, ${lead.source})` : ` (${lead.source})`} points to ${lowerLabel(hook.label)} work.`);
    points.push(hook.pitch);
    const met = approach.find((p) => p.met && p.lastMetAt);
    if (met) points.push(`Build on the ${monthYear(met.lastMetAt)} conversation with ${met.name}.`);
    else if (d.alreadySold) points.push(`We already deliver ${hook.label.toLowerCase()} work here: lead with that reference.`);
    else {
      const fin = d.chips.find((c) => c.kind === 'financial');
      if (fin && fin !== lead) points.push(`Tie it to the filed numbers: ${fin.label}.`);
    }
    const who = approach[0];
    const firstStep = who ? `${hook.nextStep.replace(/\.$/, '')} with ${who.name}${who.title ? ` (${who.title})` : ''}.` : hook.nextStep;
    return {
      rank: 0,
      theme: d.theme,
      themeLabel: hook.label,
      offering: hook.offering,
      headline: d.headline,
      whyNow: d.chips.slice(0, 5),
      approach,
      approachGap: gap,
      talkingPoints: points.slice(0, 3),
      firstStep,
      confidence: label(score),
      confidenceScore: score,
      alreadySold: d.alreadySold,
      dealRange: dealRangeFor(d.theme, input.won, input.themeOf),
      sample: d.sample,
    } satisfies PositioningPlay;
  });
  plays.sort((a, b) => Number(a.sample) - Number(b.sample) || b.confidenceScore - a.confidenceScore || a.theme.localeCompare(b.theme));
  return plays.slice(0, 3).map((p, i) => ({ ...p, rank: i + 1 }));
}

// ── gaps and risks ─────────────────────────────────────────────────────────

export interface GapInputs {
  people: KnownPerson[];
  lastMeetingAt: string | null;
  momentum: { score: number; delta: number; trend: 'gaining' | 'steady' | 'declining'; sample: boolean } | null;
  openDeals: number;
  riskEvents: Array<{ kind: string; title: string; at: string; url: string | null; source: string; sample: boolean }>;
  competitorMentions: Array<{ competitor: string; title: string; at: string | null; url: string | null; source: string }>;
  financialRisks: FinancialSignalLite[];
  financialStaleFy: number | null;
  financialSource: string | null;
  now: Date;
}

const SEV_RANK = { high: 0, medium: 1, low: 2 } as const;

export function buildGaps(g: GapInputs): AccountGap[] {
  const out: AccountGap[] = [];
  const senior = g.people.filter((p) => SENIOR.has(p.seniority));
  const metSenior = senior.filter((p) => p.met && p.lastMetAt && g.now.getTime() - Date.parse(p.lastMetAt) < 365 * DAY);
  if (!senior.length) out.push({ kind: 'senior_contacts', severity: 'high', title: 'No senior contacts mapped', detail: 'No C-level or VP is in the org chart or contacts. Map the economic buyer before pitching.', evidence: [] });
  else if (!metSenior.length) out.push({ kind: 'senior_contacts', severity: 'medium', title: `${senior.length} senior contact${senior.length > 1 ? 's' : ''}, none met in 12 months`, detail: `Known: ${senior.slice(0, 3).map((p) => p.name).join(', ')}. No meeting with them is logged in the last 12 months.`, evidence: [] });
  const days = g.lastMeetingAt ? Math.floor((g.now.getTime() - Date.parse(g.lastMeetingAt)) / DAY) : null;
  if (days === null) out.push({ kind: 'no_recent_meeting', severity: 'medium', title: 'No meetings logged', detail: 'Polo has no meeting with this account on record.', evidence: [] });
  else if (days > 90) out.push({ kind: 'no_recent_meeting', severity: days > 180 ? 'high' : 'medium', title: `Last meeting ${days} days ago`, detail: `Last logged meeting was on ${g.lastMeetingAt!.slice(0, 10)}.`, evidence: [] });
  if (g.momentum && (g.momentum.trend === 'declining' || g.momentum.delta <= -10)) {
    out.push({ kind: 'declining_momentum', severity: g.momentum.delta <= -20 ? 'high' : 'medium', title: `Momentum falling (${g.momentum.delta} in 4 weeks)`, detail: `Account pulse is ${g.momentum.score}/100${g.momentum.sample ? ', partly from sample signals' : ''}.`, evidence: [] });
  }
  const restr = g.riskEvents.filter((e) => /RESTRUCTURING|LAYOFFS|INSOLVENCY|GUIDANCE_CHANGE/.test(e.kind));
  const finRestr = g.financialRisks.filter((s) => /restructuring_charge|margin_squeeze|guidance_cut|impairment/.test(s.rule));
  if (restr.length || finRestr.length) {
    out.push({
      kind: 'restructuring',
      severity: restr.some((e) => !e.sample) || finRestr.some((s) => s.confidence === 'high' && !s.sample) ? 'high' : 'medium',
      title: 'Restructuring or cost pressure',
      detail: 'Budgets may freeze or shift to cost programmes. Position efficiency and flexible capacity.',
      evidence: [
        ...finRestr.slice(0, 2).map((s) => ({ kind: 'financial' as const, label: s.title, url: s.sourceUrl || null, anchor: ANCHOR.financial, at: s.periodEnd, source: g.financialSource ?? 'Filed financials', sample: s.sample })),
        ...restr.slice(0, 2).map((e) => ({ kind: 'news' as const, label: e.title, url: e.url, anchor: ANCHOR.news, at: e.at, source: e.source, sample: e.sample })),
      ],
    });
  }
  const lead = g.riskEvents.filter((e) => e.kind === 'LEADERSHIP_CHANGE');
  if (lead.length) out.push({ kind: 'leadership_change', severity: 'medium', title: 'Leadership change', detail: 'New leaders reset priorities and suppliers. Re-map sponsors.', evidence: lead.slice(0, 2).map((e) => ({ kind: 'news' as const, label: e.title, url: e.url, anchor: ANCHOR.news, at: e.at, source: e.source, sample: e.sample })) });
  if (g.competitorMentions.length) {
    const names = [...new Set(g.competitorMentions.map((c) => c.competitor))];
    out.push({ kind: 'competitor', severity: 'medium', title: `Competitor activity: ${names.slice(0, 3).join(', ')}`, detail: 'A tracked competitor is linked to this account. Check the deal history before positioning.', evidence: g.competitorMentions.slice(0, 3).map((c) => ({ kind: 'news' as const, label: c.title, url: c.url, anchor: ANCHOR.news, at: c.at, source: c.source, sample: false })) });
  }
  if (!g.openDeals) out.push({ kind: 'no_pipeline', severity: 'low', title: 'No open pipeline', detail: 'No open opportunity at this account. The plays above are the starting point.', evidence: [] });
  if (g.financialStaleFy) out.push({ kind: 'stale_data', severity: 'low', title: `Financials stop at FY${g.financialStaleFy}`, detail: 'The issuer no longer files at this source. Read the numbers as history.', evidence: [] });
  return out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
}

// ── brief ───────────────────────────────────────────────────────────────────

export type MoneyFmt = (value: number, currency: string) => string;
export type MicrosFmt = (micros: string) => string;

/** One plain-English paragraph built only from the facts given. */
export function composeBrief(f: BriefFacts, fmtMoney: MoneyFmt, fmtMicros: MicrosFmt): string {
  const s: string[] = [];
  const where = [f.industry ? `in ${humanIndustry(f.industry)}` : '', f.country ? `based in ${f.country}` : ''].filter(Boolean).join(', ');
  const emp = f.employees ? ` with about ${f.employees.value.toLocaleString('en-GB')} employees` : '';
  s.push(`${f.name} is a ${f.tierLabel} account${where ? ` ${where}` : ''}${emp}.`);
  if (f.financials && f.financials.revenue !== null) {
    const fin = f.financials;
    const yoy = fin.revenueYoY !== null ? ` (${fin.revenueYoY >= 0 ? 'up' : 'down'} ${Math.abs(fin.revenueYoY).toFixed(0)}% on the year)` : '';
    const m = fin.margin !== null && fin.marginLabel ? `, ${fin.marginLabel.toLowerCase()} ${fin.margin.toFixed(1)}%${fin.marginDelta !== null ? ` (${fin.marginDelta >= 0 ? '+' : ''}${fin.marginDelta.toFixed(1)} pts)` : ''}` : '';
    s.push(`Filed statements (${fin.source}) show revenue of ${fmtMoney(fin.revenue!, fin.currency)} in FY${fin.fiscalYear}${yoy}${m}${fin.stale ? ', the latest filing available' : ''}.`);
  }
  if (f.momentum) {
    const dir = f.momentum.trend === 'declining' ? 'falling' : f.momentum.trend === 'gaining' ? 'rising' : 'steady';
    s.push(`Momentum is ${dir} at ${f.momentum.score}/100 (${f.momentum.delta >= 0 ? '+' : ''}${f.momentum.delta} in 4 weeks${f.momentum.sample ? ', partly sample signals' : ''}).`);
  }
  const p = f.pipeline;
  const hist = p.won24m || p.lost24m ? `; ${p.won24m} won and ${p.lost24m} lost in the last 24 months` : '';
  s.push(p.openCount ? `We have ${p.openCount} open deal${p.openCount > 1 ? 's' : ''} worth ${fmtMicros(p.openMicros)}${hist}.` : `We have no open deals${hist}.`);
  const pe = f.people;
  if (pe.known) {
    const last = pe.lastMeeting ? `, last meeting on ${pe.lastMeeting.at.slice(0, 10)} (${pe.lastMeeting.title})` : ', no meeting logged';
    s.push(`We know ${pe.known} people there (${pe.senior} senior), ${pe.metLast12m} met in the last 12 months${last}.`);
  } else s.push('No contacts are mapped yet.');
  if (f.topSignal) s.push(`Latest notable signal: ${f.topSignal.title}${f.topSignal.at ? ` (${monthYear(f.topSignal.at)}, ${f.topSignal.source})` : ''}${f.topSignal.sample ? ' [sample]' : ''}.`);
  return s.join(' ');
}

export const POSITIONING_THEMES = InitiativeThemeSchema.options;
