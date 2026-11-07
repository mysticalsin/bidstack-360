import { buildDirection } from './direction.js';
import { OPEN_ROLE_WINDOW_DAYS, summarizeHiring, type HiringPostingInput } from './hiring.js';
import { buildInvestmentPlan } from './investment.js';
import type { StatementInput } from './statements.js';
import {
  INTEL_SOURCE_LABEL,
  IntelSourceKey,
  type AccountDirection,
  type AccountFinancialsIntel,
  type AccountHiringIntel,
  type AccountNewsIntel,
  type IntelEvidence,
  type IntelFinancialYear,
  type IntelPost,
  type IntelRegistryFact,
  type IntelRevenueFallback,
  type IntelSourceStatus,
} from './types.js';

/** A stored posting as the read model loads it. */
export interface IntelSnapshotPosting extends HiringPostingInput {
  location: string | null;
  seniority: string | null;
  fetchedAt: Date | string;
  sample: boolean;
}

/** A fiscal year as loaded, with the filed concept per metric for the evidence excerpt. */
export interface IntelSnapshotYear extends IntelFinancialYear {
  fetchedAt?: Date | string | null;
  concepts?: Partial<Record<string, string>>;
}

/** A post as loaded, with its stored excerpt and fetch time. */
export interface IntelSnapshotPost extends IntelPost {
  excerpt?: string;
  fetchedAt?: Date | string | null;
}

/** Everything stored about one account, before composition. */
export interface CompanyIntelSnapshot {
  company: { id: string; name: string };
  years: IntelSnapshotYear[];
  postings: IntelSnapshotPosting[];
  posts: IntelSnapshotPost[];
  statements: StatementInput[];
  /** Ledger rows (registry facts, identifier matches, filing statements). */
  evidence: IntelEvidence[];
  registry: IntelRegistryFact[];
  revenueFallback: IntelRevenueFallback | null;
  sources: IntelSourceStatus[];
  sample: boolean;
  now: Date;
}

/** All four read models for one account. */
export interface ComposedIntel {
  direction: AccountDirection;
  hiring: AccountHiringIntel;
  financials: AccountFinancialsIntel;
  news: AccountNewsIntel;
}

const DAY = 86_400_000;
const RECENT_POST_DAYS = 365;
const MAX_HIRING_EVIDENCE = 20;

const iso = (v: Date | string | null | undefined): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const ATS_LABEL: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  recruitee: 'Recruitee',
  personio: 'Personio',
  careers_jsonld: 'Careers page (schema.org JobPosting)',
  theirstack: 'TheirStack',
  adzuna: 'Adzuna',
  apollo: 'Apollo',
  seamless: 'Seamless',
  fixture: 'Sample data',
};

/** Display label for a posting source. */
export const postingSourceLabel = (s: string): string => ATS_LABEL[s] ?? s;

const METRIC_WORD: Array<[keyof IntelFinancialYear, string]> = [
  ['revenue', 'Revenue'],
  ['capex', 'Capex'],
  ['rnd', 'R&D'],
  ['acquisitions', 'Acquisitions'],
  ['intangibles', 'Software and intangibles'],
  ['debtIssued', 'Debt raised'],
  ['headcount', 'Headcount'],
  ['restructuring', 'Restructuring'],
];

function yearExcerpt(y: IntelSnapshotYear): string {
  const parts = METRIC_WORD.flatMap(([k, label]) => {
    const v = y[k];
    if (typeof v !== 'number') return [];
    const unit = k === 'headcount' ? '' : y.currency ? ` ${y.currency}` : '';
    const concept = y.concepts?.[k as string];
    return [`${label} ${Math.round(v).toLocaleString('en-US')}${unit}${concept ? ` (${concept})` : ''}`];
  });
  return `FY${y.fiscalYear}, period ended ${y.periodEnd}, ${y.source}: ${parts.join('; ') || 'no key lines filed'}`;
}

function isOpen(p: IntelSnapshotPosting, now: Date): boolean {
  const t = iso(p.lastSeenAt) ?? iso(p.postedAt);
  return !!t && now.getTime() - Date.parse(t) <= OPEN_ROLE_WINDOW_DAYS * DAY;
}

function allSources(given: IntelSourceStatus[]): IntelSourceStatus[] {
  return IntelSourceKey.options.map(
    (key) => given.find((s) => s.key === key) ?? { key, label: INTEL_SOURCE_LABEL[key], status: 'never', lastFetchedAt: null, result: { new: 0, updated: 0, skipped: 0, failed: 0 }, detail: null },
  );
}

/**
 * Compose the direction, hiring, financials and news read models from one
 * snapshot. Every derived line is checked to cite evidence that is returned
 * alongside it; lines whose evidence is missing are dropped, not shown.
 */
export function composeAccountIntel(s: CompanyIntelSnapshot): ComposedIntel {
  const now = s.now;
  const evidence = new Map<string, IntelEvidence>(s.evidence.map((e) => [e.id, e]));
  const years = [...s.years].sort((a, b) => a.fiscalYear - b.fiscalYear);
  for (const y of years) {
    if (!evidence.has(y.evidenceId)) {
      evidence.set(y.evidenceId, { id: y.evidenceId, source: y.source, sourceLabel: y.source, url: y.sourceUrl, fetchedAt: iso(y.fetchedAt) ?? `${y.periodEnd}T00:00:00.000Z`, excerpt: yearExcerpt(y), locator: `FY${y.fiscalYear}`, sample: y.sample });
    }
  }

  const postings = [...s.postings].sort((a, b) => (iso(b.postedAt) ?? '').localeCompare(iso(a.postedAt) ?? ''));
  const open = postings.filter((p) => isOpen(p, now));
  const cited = (open.length ? open : postings.filter((p) => { const t = iso(p.postedAt); return !!t && now.getTime() - Date.parse(t) <= 90 * DAY; })).slice(0, MAX_HIRING_EVIDENCE);
  for (const p of cited) {
    const id = `job:${p.id}`;
    if (!evidence.has(id)) evidence.set(id, { id, source: p.source, sourceLabel: postingSourceLabel(p.source), url: p.url, fetchedAt: iso(p.fetchedAt) ?? now.toISOString(), excerpt: `${p.title}${p.location ? ` (${p.location})` : ''}${p.department ? `, ${p.department}` : ''}`, locator: null, sample: p.sample });
  }
  const summary = summarizeHiring(postings, now);
  const hiring = postings.length ? { summary, evidenceIds: cited.map((p) => `job:${p.id}`) } : null;

  const posts = [...s.posts].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  for (const p of posts) {
    if (!evidence.has(p.evidenceId)) evidence.set(p.evidenceId, { id: p.evidenceId, source: p.source, sourceLabel: p.sourceLabel, url: p.url, fetchedAt: iso(p.fetchedAt) ?? p.publishedAt ?? now.toISOString(), excerpt: p.excerpt?.trim() || p.title, locator: null, sample: p.sample });
  }
  const recent = posts.filter((p) => !p.publishedAt || now.getTime() - Date.parse(p.publishedAt) <= RECENT_POST_DAYS * DAY);
  const statements = s.statements.filter((st) => evidence.has(st.evidenceId));

  const plan = buildInvestmentPlan({ years, statements, hiring, posts: recent });
  const dir = buildDirection({ companyName: s.company.name, years, hiring, posts: recent, plan });

  const resolves = (ids: string[]) => ids.length > 0 && ids.every((id) => evidence.has(id));
  const claims = dir.claims.filter((c) => resolves(c.evidenceIds));
  const used = new Set<string>();
  const keep = <T extends { evidenceIds: string[] }>(rows: T[]) => rows.filter((r) => resolves(r.evidenceIds)).map((r) => (r.evidenceIds.forEach((id) => used.add(id)), r));
  const investing = keep(plan.investing);
  const cutting = keep(plan.cutting);
  const next12 = keep(plan.next12);
  const bidRelevance = keep(dir.bidRelevance);
  const headline = dir.headline && resolves(dir.headline.evidenceIds) ? dir.headline : null;
  for (const c of claims) c.evidenceIds.forEach((id) => used.add(id));
  headline?.evidenceIds.forEach((id) => used.add(id));

  const direction: AccountDirection = {
    companyId: s.company.id,
    companyName: s.company.name,
    computedAt: now.toISOString(),
    headline,
    claims,
    investing,
    cutting,
    next12,
    bidRelevance,
    evidence: [...evidence.values()].filter((e) => used.has(e.id)),
    sources: allSources(s.sources),
    sample: s.sample,
  };

  return {
    direction,
    hiring: {
      companyId: s.company.id,
      summary,
      postings: postings.slice(0, 100).map((p) => ({ id: p.id, title: p.title, department: p.department, function: p.function, location: p.location, seniority: p.seniority, skills: p.skills, postedAt: iso(p.postedAt), url: p.url, source: p.source, sample: p.sample })),
      sample: postings.some((p) => p.sample),
    },
    financials: {
      companyId: s.company.id,
      years: years.map(({ fetchedAt: _f, concepts: _c, ...y }) => y),
      revenueFallback: years.some((y) => y.revenue != null) ? null : s.revenueFallback,
      registry: s.registry,
      sample: years.some((y) => y.sample),
    },
    news: {
      companyId: s.company.id,
      items: posts.slice(0, 100).map(({ excerpt: _e, fetchedAt: _f, ...p }) => p),
      sample: posts.some((p) => p.sample),
    },
  };
}
