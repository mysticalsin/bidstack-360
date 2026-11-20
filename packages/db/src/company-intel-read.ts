/**
 * Account intelligence read model loader (slice 12). Loads every stored fact
 * for one account, scoped by org, into the snapshot that
 * `composeAccountIntel` turns into the direction, hiring, financials and
 * news views. Shared by the API, the MCP server and the worker.
 */
import {
  classifyPost,
  FINANCIAL_SOURCE_LABEL,
  INTEL_SOURCE_LABEL,
  IntelPostKind,
  IntelSourceKey,
  type CompanyIntelSnapshot,
  type IntelEvidence,
  type IntelSnapshotPost,
  type IntelSnapshotYear,
  type IntelSourceStatus,
  type StatementInput,
} from '@bidstack/shared';

import type { PrismaClient } from '../generated/client/index.js';

export type { CompanyIntelSnapshot } from '@bidstack/shared';

type Db = Pick<PrismaClient, 'company' | 'accountFinancialPeriod' | 'companyJobPosting' | 'companyPost' | 'accountWatchEvent' | 'intelEvidence' | 'intelSourceRun' | 'companyFirmographics'>;

const DAY = 86_400_000;
const SOURCE_PRIORITY: Record<string, number> = { sec_edgar: 0, esef: 1, brreg: 2, fr_rne: 3, fixture: 9 };
const POST_LABEL: Record<string, string> = { newsroom: 'Company newsroom', sitemap: 'Company news sitemap', ir_feed: 'Investor relations feed', fixture: 'Sample data' };
const NEWS_LABEL: Record<string, string> = { gdelt: 'GDELT news', google_news: 'Google News', company_rss: 'Company press feed', ir_feed: 'IR feed', sec_edgar: 'SEC EDGAR', companies_house: 'Companies House', fixture: 'Sample data' };
const LEDGER_LABEL: Record<string, string> = {
  ...FINANCIAL_SOURCE_LABEL,
  gleif: 'GLEIF',
  companies_house: 'Companies House',
  opencorporates: 'OpenCorporates',
  careers_page: 'Careers page',
};
/** News sources left out of the account view: derived events and LinkedIn-sourced items. */
const NEWS_EXCLUDED = ['financials', 'apify_linkedin'];

type MetricJson = Record<string, { value?: unknown; concept?: unknown } | undefined> & { _derived?: { operatingMargin?: number | null; netMargin?: number | null } };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

function yearFromPeriod(p: { id: string; source: string; fiscalYear: number; periodEnd: Date; currency: string; sourceUrl: string; metrics: unknown; updatedAt: Date }): IntelSnapshotYear {
  const m = (p.metrics ?? {}) as MetricJson;
  const v = (k: string) => num(m[k]?.value);
  const concepts: Record<string, string> = {};
  for (const [k, val] of Object.entries(m)) {
    const concept = k === '_derived' ? null : (val as { concept?: unknown } | undefined)?.concept;
    if (typeof concept === 'string') concepts[k] = concept;
  }
  const revenue = v('revenue');
  const op = v('operatingIncome');
  const net = v('netIncome');
  const margin = (x: number | null) => (revenue && x != null && revenue > 0 ? Math.round((x / revenue) * 1000) / 10 : null);
  return {
    fiscalYear: p.fiscalYear,
    periodEnd: dateOnly(p.periodEnd),
    currency: p.currency || null,
    source: FINANCIAL_SOURCE_LABEL[p.source] ?? p.source,
    sourceUrl: p.sourceUrl || null,
    revenue,
    operatingMargin: num(m._derived?.operatingMargin) ?? margin(op),
    netMargin: num(m._derived?.netMargin) ?? margin(net),
    capex: v('capex') != null ? Math.abs(v('capex')!) : null,
    rnd: v('rnd'),
    acquisitions: v('acquisitions') != null ? Math.abs(v('acquisitions')!) : null,
    intangibles: v('intangibles') != null ? Math.abs(v('intangibles')!) : null,
    debtIssued: v('debtIssued'),
    cash: v('cash'),
    debt: v('debt'),
    headcount: v('headcount'),
    restructuring: v('restructuring'),
    sample: p.source === 'fixture',
    evidenceId: `fin:${p.id}`,
    fetchedAt: p.updatedAt,
    concepts,
  };
}

const POSTING_PAGE = 1000;

/**
 * Every posting in the window: the hiring summary counts open roles and 30/90
 * day trends over all of them, so a row cap here would skew the aggregates.
 * Callers cap the detail list. Read in pages to stay under the query guard.
 */
async function loadPostings(db: Db, orgId: string, companyId: string, since: Date) {
  const select = { id: true, source: true, title: true, url: true, city: true, country: true, function: true, seniority: true, skills: true, department: true, postedAt: true, lastSeenAt: true, fetchedAt: true, sample: true } as const;
  const out = [];
  for (let cursor: string | undefined; ; ) {
    const page = await db.companyJobPosting.findMany({
      where: { orgId, companyId, OR: [{ postedAt: { gte: since } }, { lastSeenAt: { gte: since } }] },
      orderBy: { id: 'asc' },
      take: POSTING_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select,
    });
    out.push(...page);
    if (page.length < POSTING_PAGE) break;
    cursor = page[page.length - 1]!.id;
  }
  return out.sort((a, b) => (b.postedAt?.getTime() ?? -Infinity) - (a.postedAt?.getTime() ?? -Infinity));
}

/** Load everything stored about one account. Null when the account is not in the org. */
export async function loadCompanyIntel(db: Db, orgId: string, companyId: string, now: Date = new Date()): Promise<CompanyIntelSnapshot | null> {
  const company = await db.company.findFirst({ where: { id: companyId, orgId, deletedAt: null }, select: { id: true, name: true } });
  if (!company) return null;
  const since = new Date(now.getTime() - 365 * DAY);
  const newsSince = new Date(now.getTime() - 180 * DAY);

  const [periods, postings, posts, events, ledger, runs, firmo] = await Promise.all([
    db.accountFinancialPeriod.findMany({ where: { orgId, companyId, periodType: 'FY' }, orderBy: { periodEnd: 'desc' }, take: 40, select: { id: true, source: true, fiscalYear: true, periodEnd: true, currency: true, sourceUrl: true, metrics: true, updatedAt: true } }),
    loadPostings(db, orgId, companyId, since),
    db.companyPost.findMany({ where: { orgId, companyId }, orderBy: { publishedAt: 'desc' }, take: 60, select: { id: true, source: true, url: true, title: true, excerpt: true, kind: true, publishedAt: true, fetchedAt: true, sample: true } }),
    db.accountWatchEvent.findMany({ where: { orgId, companyId, occurredAt: { gte: newsSince }, source: { notIn: NEWS_EXCLUDED } }, orderBy: { occurredAt: 'desc' }, take: 40, select: { id: true, source: true, title: true, sourceUrl: true, summary: true, occurredAt: true, detectedAt: true } }),
    db.intelEvidence.findMany({ where: { orgId, companyId, kind: { in: ['registry', 'statement'] } }, orderBy: { fetchedAt: 'desc' }, take: 200 }),
    db.intelSourceRun.findMany({ where: { orgId, companyId }, take: 10 }),
    db.companyFirmographics.findFirst({ where: { orgId, companyId }, select: { annualRevenueUsd: true, revenueRange: true, provenance: true, fetchedAt: true } }),
  ]);

  const bestByYear = new Map<number, (typeof periods)[number]>();
  for (const p of periods) {
    const cur = bestByYear.get(p.fiscalYear);
    if (!cur || (SOURCE_PRIORITY[p.source] ?? 5) < (SOURCE_PRIORITY[cur.source] ?? 5)) bestByYear.set(p.fiscalYear, p);
  }
  const years = [...bestByYear.values()].map(yearFromPeriod).sort((a, b) => a.fiscalYear - b.fiscalYear).slice(-6);

  const ownPosts: IntelSnapshotPost[] = posts.map((p) => ({
    id: p.id,
    origin: 'own',
    kind: IntelPostKind.safeParse(p.kind).success ? (p.kind as IntelSnapshotPost['kind']) : classifyPost(p.title).kind,
    title: p.title,
    url: p.url,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    source: p.source,
    sourceLabel: POST_LABEL[p.source] ?? p.source,
    sample: p.sample,
    evidenceId: `post:${p.id}`,
    excerpt: p.excerpt,
    fetchedAt: p.fetchedAt,
  }));
  const ownUrls = new Set(ownPosts.map((p) => p.url).filter(Boolean));
  const newsPosts: IntelSnapshotPost[] = events.filter((e) => !ownUrls.has(e.sourceUrl)).map((e) => ({
    id: e.id,
    origin: 'news',
    kind: classifyPost(e.title).kind,
    title: e.title,
    url: e.sourceUrl,
    publishedAt: e.occurredAt.toISOString(),
    source: e.source,
    sourceLabel: NEWS_LABEL[e.source] ?? e.source,
    sample: e.source === 'fixture',
    evidenceId: `news:${e.id}`,
    excerpt: e.summary,
    fetchedAt: e.detectedAt,
  }));

  const evidence: IntelEvidence[] = ledger.map((r) => ({ id: `ev:${r.id}`, source: r.source, sourceLabel: LEDGER_LABEL[r.source] ?? r.source, url: r.url, fetchedAt: r.fetchedAt.toISOString(), excerpt: r.excerpt, locator: r.locator, sample: r.sample }));
  const statements: StatementInput[] = ledger
    .filter((r) => r.kind === 'statement' && (r.stance === 'invest' || r.stance === 'cut' || r.stance === 'guidance'))
    .map((r) => ({ evidenceId: `ev:${r.id}`, text: r.excerpt, stance: r.stance as StatementInput['stance'], theme: (r.theme ?? null) as StatementInput['theme'] }));
  const registry = ledger
    .filter((r) => r.kind === 'registry' && r.label)
    .map((r) => ({ label: r.label!, value: r.excerpt.startsWith(`${r.label}: `) ? r.excerpt.slice(r.label!.length + 2) : r.excerpt, source: LEDGER_LABEL[r.source] ?? r.source, sourceUrl: r.url, fetchedAt: r.fetchedAt.toISOString() }));

  const sources: IntelSourceStatus[] = runs
    .filter((r) => IntelSourceKey.safeParse(r.source).success)
    .map((r) => {
      const res = (r.result ?? {}) as Record<string, unknown>;
      const n = (k: string) => (typeof res[k] === 'number' ? (res[k] as number) : 0);
      const key = r.source as IntelSourceStatus['key'];
      return { key, label: INTEL_SOURCE_LABEL[key], status: r.status as IntelSourceStatus['status'], lastFetchedAt: r.lastFetchedAt?.toISOString() ?? null, result: { new: n('new'), updated: n('updated'), skipped: n('skipped'), failed: n('failed') }, detail: r.detail };
    });

  const prov = (firmo?.provenance ?? {}) as Record<string, { source?: string; fetchedAt?: string } | undefined>;
  const fbSource = prov.annualRevenueUsd?.source ?? prov.revenueRange?.source ?? 'apollo';
  const revenueFallback =
    firmo && (firmo.annualRevenueUsd != null || firmo.revenueRange)
      ? {
          label: firmo.revenueRange ? `Revenue range ${firmo.revenueRange}` : `Revenue about USD ${Number(firmo.annualRevenueUsd).toLocaleString('en-US')}`,
          amountUsd: firmo.annualRevenueUsd != null ? Number(firmo.annualRevenueUsd) : null,
          source: fbSource.charAt(0).toUpperCase() + fbSource.slice(1),
          asOf: firmo.fetchedAt?.toISOString() ?? prov.annualRevenueUsd?.fetchedAt ?? null,
        }
      : null;

  const snapshotPostings = postings.map((p) => ({
    id: p.id,
    title: p.title,
    function: p.function,
    department: p.department,
    skills: p.skills,
    postedAt: p.postedAt,
    lastSeenAt: p.lastSeenAt,
    source: p.source,
    url: p.url,
    location: [p.city, p.country].filter(Boolean).join(', ') || null,
    seniority: p.seniority,
    fetchedAt: p.fetchedAt,
    sample: p.sample,
  }));
  const sample = years.some((y) => y.sample) || snapshotPostings.some((p) => p.sample) || ownPosts.some((p) => p.sample);

  return { company, years, postings: snapshotPostings, posts: [...ownPosts, ...newsPosts], statements, evidence, registry, revenueFallback, sources, sample, now };
}
