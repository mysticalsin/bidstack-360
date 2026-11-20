import { OFFERING_HOOKS, type InitiativeTheme } from '../schemas/account-signals.js';
import { hiringThemes, type HiringInput } from './hiring.js';
import { compactAmount, type FinancialYearInput, type InvestmentPlan } from './investment.js';
import { classifyPost, POST_KIND_LABEL } from './posts.js';
import type { BidRelevance, IntelClaim, IntelPost, IntelPostKind } from './types.js';

/** Inputs to the direction summary. */
export interface DirectionInput {
  companyName: string;
  years: FinancialYearInput[];
  hiring: HiringInput | null;
  posts: IntelPost[];
  plan: InvestmentPlan;
}

/** Headline, cited claims and bid relevance for one account. */
export interface DirectionResult {
  headline: IntelClaim | null;
  claims: IntelClaim[];
  bidRelevance: BidRelevance[];
}

const MAX_POST_EVIDENCE = 6;

function financialClaim(years: FinancialYearInput[]): IntelClaim | null {
  const withRevenue = [...years].filter((y) => y.revenue != null).sort((a, b) => a.fiscalYear - b.fiscalYear);
  const latest = withRevenue.at(-1);
  if (!latest || latest.revenue == null) return null;
  const prev = withRevenue.length > 1 ? withRevenue.at(-2)! : null;
  const cur = latest.currency ? ` ${latest.currency}` : '';
  let text = `Revenue ${compactAmount(latest.revenue)}${cur} in FY${latest.fiscalYear}`;
  const ids = [latest.evidenceId];
  if (prev?.revenue) {
    const t = Math.round(((latest.revenue - prev.revenue) / prev.revenue) * 100);
    text = `Revenue ${t >= 0 ? 'up' : 'down'} ${Math.abs(t)}% to ${compactAmount(latest.revenue)}${cur} in FY${latest.fiscalYear}`;
    ids.push(prev.evidenceId);
  }
  if (latest.operatingMargin != null) {
    const was = prev?.operatingMargin != null ? ` (FY${prev.fiscalYear}: ${prev.operatingMargin.toFixed(1)}%)` : '';
    text += `, operating margin ${latest.operatingMargin.toFixed(1)}%${was}`;
  }
  if (latest.sample) text += ', sample data';
  return { id: 'claim-financials', area: 'financials', text, basis: 'observed', theme: null, evidenceIds: ids };
}

function hiringClaim(hiring: HiringInput | null): IntelClaim | null {
  if (!hiring || !hiring.evidenceIds.length) return null;
  const s = hiring.summary;
  if (s.openRoles === 0 && s.posted90 === 0) return null;
  const top = s.byFunction.slice(0, 2).map((f) => `${f.label} ${f.count}`).join(', ');
  const trend = s.trend30Pct == null ? '' : `, postings ${s.trend30Pct >= 0 ? 'up' : 'down'} ${Math.abs(s.trend30Pct)}% over 30 days`;
  const skills = s.skills.slice(0, 3).map((k) => k.skill);
  const text = `${s.openRoles} open roles${top ? ` (${top})` : ''}${trend}${skills.length ? `; skills ${skills.join(', ')}` : ''}`;
  return { id: 'claim-hiring', area: 'hiring', text, basis: 'observed', theme: null, evidenceIds: [...hiring.evidenceIds] };
}

function postsClaim(posts: IntelPost[], origin: IntelPost['origin']): IntelClaim | null {
  const mine = posts.filter((p) => p.origin === origin);
  if (!mine.length) return null;
  const byKind = new Map<IntelPostKind, number>();
  for (const p of mine) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
  const mix = [...byKind.entries()]
    .filter(([k]) => k !== 'other')
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${POST_KIND_LABEL[k].toLowerCase()}`)
    .join(', ');
  const noun = origin === 'own' ? 'company posts' : 'news items';
  const text = `${mine.length} ${noun}${mix ? `: ${mix}` : ''}. Latest: ${mine[0]!.title}`;
  return { id: `claim-${origin === 'own' ? 'posts' : 'news'}`, area: origin === 'own' ? 'posts' : 'news', text, basis: 'observed', theme: null, evidenceIds: mine.slice(0, MAX_POST_EVIDENCE).map((p) => p.evidenceId) };
}

function bidRelevance(input: DirectionInput): BidRelevance[] {
  const acc = new Map<InitiativeTheme, { score: number; ids: Set<string> }>();
  const add = (theme: InitiativeTheme | null, weight: number, ids: string[]) => {
    if (!theme || !ids.length) return;
    const cur = acc.get(theme) ?? { score: 0, ids: new Set<string>() };
    cur.score += weight;
    for (const id of ids) cur.ids.add(id);
    acc.set(theme, cur);
  };
  for (const n of input.plan.next12) add(n.theme, 3, n.evidenceIds);
  for (const l of input.plan.investing) add(l.theme, 2, l.evidenceIds);
  for (const l of input.plan.cutting) if (l.theme === 'workforce') add(l.theme, 1, l.evidenceIds);
  if (input.hiring && input.hiring.summary.openRoles > 0) {
    for (const [th] of hiringThemes(input.hiring.summary)) add(th, 1, input.hiring.evidenceIds);
  }
  for (const p of input.posts) add(classifyPost(p.title).theme, 1, [p.evidenceId]);
  return [...acc.entries()]
    .sort((a, b) => b[1].score - a[1].score || b[1].ids.size - a[1].ids.size || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([theme, v]) => {
      const hook = OFFERING_HOOKS[theme];
      return { theme, label: hook.label, offering: hook.offering, pitch: hook.pitch, nextStep: hook.nextStep, score: v.score, evidenceIds: [...v.ids] };
    });
}

/**
 * Cross-references financials, hiring, posts and the investment plan into one
 * view. Every claim cites evidence; the headline is always marked inferred.
 */
export function buildDirection(input: DirectionInput): DirectionResult {
  const claims: IntelClaim[] = [];
  const push = (c: IntelClaim | null) => {
    if (c && c.evidenceIds.length) claims.push(c);
  };
  push(financialClaim(input.years));
  push(hiringClaim(input.hiring));
  push(postsClaim(input.posts, 'own'));
  push(postsClaim(input.posts, 'news'));
  const inv = input.plan.investing.find((l) => l.basis === 'observed') ?? input.plan.investing[0];
  if (inv) push({ id: 'claim-investing', area: 'investment', text: inv.summary, basis: inv.basis, theme: inv.theme, evidenceIds: inv.evidenceIds });
  const cut = input.plan.cutting[0];
  if (cut) push({ id: 'claim-cutting', area: 'investment', text: cut.summary, basis: cut.basis, theme: cut.theme, evidenceIds: cut.evidenceIds });

  let headline: IntelClaim | null = null;
  const next = input.plan.next12[0];
  if (next) {
    headline = { id: 'headline', area: 'direction', text: `${input.companyName} is likely to invest next in ${next.label}`, basis: 'inferred', theme: next.theme, evidenceIds: next.evidenceIds };
  } else if (claims.length) {
    const lead = claims[0]!;
    headline = { id: 'headline', area: 'direction', text: `${input.companyName}: ${lead.text}`, basis: 'inferred', theme: lead.theme, evidenceIds: lead.evidenceIds };
  }

  return { headline, claims, bidRelevance: bidRelevance(input) };
}
