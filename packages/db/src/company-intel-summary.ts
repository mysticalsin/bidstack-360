/**
 * Company intel summary store (slice 14). Loads the stored facts for one
 * company, builds the list-level summary with `buildIntelSummary`, and keeps
 * one row per company in company_intel_summaries. Also tracks enrichment
 * progress for the companies an import created (intel_import_batches).
 * Every query is scoped by org.
 */
import {
  buildIntelSummary,
  classifyPost,
  CompanyIntelSummary,
  IntelImportBatchView,
  IntelPostKind,
  type IntelSummaryInput,
  type IntelSummaryRuns,
} from '@bidstack/shared';

import type { Prisma, PrismaClient } from '../generated/client/index.js';

type Db = Pick<
  PrismaClient,
  | 'company'
  | 'accountFinancialPeriod'
  | 'companyJobPosting'
  | 'companyPost'
  | 'accountWatchEvent'
  | 'intelSourceRun'
  | 'companyFirmographics'
  | 'companyIntelSummary'
  | 'intelImportBatch'
  | '$queryRaw'
>;

const DAY = 86_400_000;
const POST_LABEL: Record<string, string> = {
  newsroom: 'Company newsroom',
  sitemap: 'Company news sitemap',
  ir_feed: 'Investor relations feed',
  fixture: 'Sample data',
};
const NEWS_LABEL: Record<string, string> = {
  gdelt: 'GDELT news',
  google_news: 'Google News',
  company_rss: 'Company press feed',
  ir_feed: 'IR feed',
  sec_edgar: 'SEC EDGAR',
  companies_house: 'Companies House',
  apollo: 'Apollo',
  fixture: 'Sample data',
};
const NEWS_EXCLUDED = ['financials', 'apify_linkedin'];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Which sources the server can reach, read from env names only. */
export function intelConnections(
  env: Record<string, string | undefined>,
): IntelSummaryInput['connections'] {
  const ua = (env.ACCOUNT_INTEL_USER_AGENT ?? env.SEC_USER_AGENT ?? '').trim();
  return { publicSources: /@/.test(ua), apollo: Boolean(env.APOLLO_API_KEY?.trim()) };
}

const POSTING_PAGE = 500;
/** Hard stop so one runaway board cannot exhaust memory; far above any real employer. */
const POSTING_CEILING = 20_000;

/**
 * Every posting in the reporting window, paged. The ceiling is a memory stop,
 * not a claim that the board ended. `truncated` is true when more rows exist.
 */
const POSTING_SELECT = {
  id: true,
  source: true,
  title: true,
  url: true,
  function: true,
  skills: true,
  department: true,
  postedAt: true,
  lastSeenAt: true,
  fetchedAt: true,
  sample: true,
} as const;
type QualifyingPosting = Prisma.CompanyJobPostingGetPayload<{ select: typeof POSTING_SELECT }>;

async function loadQualifyingPostings(
  db: Db,
  orgId: string,
  companyId: string,
  since: Date,
): Promise<{ rows: QualifyingPosting[]; truncated: boolean }> {
  const select = POSTING_SELECT;
  const window = {
    orgId,
    companyId,
    OR: [{ postedAt: { gte: since } }, { lastSeenAt: { gte: since } }],
  };
  const live = await db.companyJobPosting.findFirst({
    where: { ...window, sample: false },
    select: { id: true },
  });
  const where = live ? { ...window, sample: false } : window;
  const orderBy = [{ postedAt: 'desc' as const }, { id: 'desc' as const }];
  const all: QualifyingPosting[] = [];
  let truncated = false;
  for (let cursor: string | undefined; all.length < POSTING_CEILING; ) {
    const page = await db.companyJobPosting.findMany({
      where,
      orderBy,
      take: POSTING_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select,
    });
    const room = POSTING_CEILING - all.length;
    all.push(...page.slice(0, room));
    if (page.length > room) {
      truncated = true;
      break;
    }
    if (page.length < POSTING_PAGE) break;
    cursor = page[page.length - 1]!.id;
    if (all.length >= POSTING_CEILING) {
      const extra = await db.companyJobPosting.findMany({
        where,
        orderBy,
        take: 1,
        cursor: { id: cursor },
        skip: 1,
        select: { id: true },
      });
      truncated = extra.length > 0;
      break;
    }
  }
  return { rows: all, truncated };
}

/** Load everything the summary is built from. Null when the company is not in the org. */
export async function loadIntelSummaryInput(
  db: Db,
  orgId: string,
  companyId: string,
  opts: { now: Date; connections: IntelSummaryInput['connections'] },
): Promise<IntelSummaryInput | null> {
  const company = await db.company.findFirst({
    where: { id: companyId, orgId, deletedAt: null },
    select: { id: true, employeeCount: true, industry: true, updatedAt: true },
  });
  if (!company) return null;
  const since = new Date(opts.now.getTime() - 365 * DAY);
  const newsSince = new Date(opts.now.getTime() - 180 * DAY);
  const [periods, postings, posts, events, runs, firmo] = await Promise.all([
    db.accountFinancialPeriod.findMany({
      where: { orgId, companyId, periodType: 'FY' },
      orderBy: { periodEnd: 'desc' },
      take: 40,
      select: {
        source: true,
        fiscalYear: true,
        periodEnd: true,
        currency: true,
        metrics: true,
        updatedAt: true,
      },
    }),
    loadQualifyingPostings(db, orgId, companyId, since),
    db.companyPost.findMany({
      where: { orgId, companyId },
      orderBy: { publishedAt: 'desc' },
      take: 30,
      select: { source: true, url: true, title: true, kind: true, publishedAt: true, sample: true },
    }),
    db.accountWatchEvent.findMany({
      where: { orgId, companyId, occurredAt: { gte: newsSince }, source: { notIn: NEWS_EXCLUDED } },
      orderBy: { occurredAt: 'desc' },
      take: 20,
      select: { source: true, title: true, sourceUrl: true, occurredAt: true },
    }),
    db.intelSourceRun.findMany({
      where: { orgId, companyId },
      take: 10,
      select: { source: true, status: true, lastFetchedAt: true },
    }),
    db.companyFirmographics.findFirst({ where: { orgId, companyId } }),
  ]);

  const metric = (m: unknown, k: string) =>
    num(((m ?? {}) as Record<string, { value?: unknown } | undefined>)[k]?.value);
  const runMap: IntelSummaryRuns = {};
  for (const r of runs) {
    if (
      r.source === 'hiring' ||
      r.source === 'posts' ||
      r.source === 'financials' ||
      r.source === 'registry'
    )
      runMap[r.source] = { status: r.status, lastFetchedAt: iso(r.lastFetchedAt) };
  }
  const ownUrls = new Set(posts.map((p) => p.url).filter(Boolean));
  const kindOf = (k: string, title: string) =>
    IntelPostKind.safeParse(k).success ? (k as IntelPostKind) : classifyPost(title).kind;

  return {
    companyId,
    now: opts.now,
    connections: opts.connections,
    runs: runMap,
    crm: {
      employeeCount: company.employeeCount,
      industry: company.industry,
      updatedAt: iso(company.updatedAt),
    },
    years: periods.map((p) => ({
      fiscalYear: p.fiscalYear,
      periodEnd: p.periodEnd.toISOString().slice(0, 10),
      currency: p.currency || null,
      source: p.source,
      revenue: metric(p.metrics, 'revenue'),
      headcount: metric(p.metrics, 'headcount'),
      fetchedAt: iso(p.updatedAt),
    })),
    postings: postings.rows.map((p) => ({ ...p, fetchedAt: iso(p.fetchedAt) })),
    postingsTruncated: postings.truncated,
    posts: [
      ...posts.map((p) => ({
        kind: kindOf(p.kind, p.title),
        title: p.title,
        url: p.url,
        publishedAt: iso(p.publishedAt),
        sourceLabel: POST_LABEL[p.source] ?? p.source,
        sample: p.sample,
      })),
      ...events
        .filter((e) => !ownUrls.has(e.sourceUrl))
        .map((e) => ({
          kind: classifyPost(e.title).kind,
          title: e.title,
          url: e.sourceUrl || null,
          publishedAt: iso(e.occurredAt),
          sourceLabel: NEWS_LABEL[e.source] ?? e.source,
          sample: e.source === 'fixture',
        })),
    ],
    firmographics: firmo
      ? {
          annualRevenueUsd: firmo.annualRevenueUsd != null ? Number(firmo.annualRevenueUsd) : null,
          revenueRange: firmo.revenueRange,
          employeeCount: firmo.employeeCount,
          headcountGrowth6m: firmo.headcountGrowth6m,
          headcountGrowth12m: firmo.headcountGrowth12m,
          totalFundingUsd: firmo.totalFundingUsd != null ? Number(firmo.totalFundingUsd) : null,
          latestFundingStage: firmo.latestFundingStage,
          latestFundingAt: iso(firmo.latestFundingAt),
          foundedYear: firmo.foundedYear,
          industry: firmo.industry,
          techStack: firmo.techStack,
          departmentHeadcount: (firmo.departmentHeadcount ?? null) as Record<string, number> | null,
          provenance: (firmo.provenance ?? {}) as Record<
            string,
            { source?: string; fetchedAt?: string }
          >,
          fetchedAt: iso(firmo.fetchedAt),
        }
      : null,
  };
}

/** Rebuild and store one company's summary. Null when the company is not in the org. */
export async function recomputeCompanyIntelSummary(
  db: Db,
  orgId: string,
  companyId: string,
  opts: { now: Date; connections: IntelSummaryInput['connections'] },
): Promise<CompanyIntelSummary | null> {
  const input = await loadIntelSummaryInput(db, orgId, companyId, opts);
  if (!input) return null;
  const s = buildIntelSummary(input);
  const data = {
    revenueUsdApprox: s.revenue?.approxUsd ?? null,
    revenueGrowthPct: s.revenueGrowth?.value ?? null,
    headcount: s.headcount ? Math.round(s.headcount.value) : null,
    headcountGrowthPct: s.headcountGrowth?.value ?? null,
    openRoles: s.openRoles?.value ?? null,
    newRoles30d: s.newRoles30d?.value ?? null,
    fundingUsd: s.funding?.value ?? null,
    direction: s.direction?.value ?? null,
    payload: s as unknown as Prisma.InputJsonValue,
    sample: s.sample,
    computedAt: opts.now,
  };
  await db.companyIntelSummary.upsert({
    where: { companyId },
    create: { orgId, companyId, ...data },
    update: data,
  });
  return s;
}

/** Parse a stored payload; null when it no longer matches the contract. */
export function parseIntelSummary(payload: unknown): CompanyIntelSummary | null {
  const r = CompanyIntelSummary.safeParse(payload);
  return r.success ? r.data : null;
}

/** Stored summaries for the given companies in this org. */
export async function readCompanyIntelSummaries(
  db: Db,
  orgId: string,
  companyIds: string[],
): Promise<Map<string, CompanyIntelSummary>> {
  const out = new Map<string, CompanyIntelSummary>();
  if (!companyIds.length) return out;
  const rows = await db.companyIntelSummary.findMany({
    where: { orgId, companyId: { in: companyIds } },
    select: { companyId: true, payload: true },
    take: companyIds.length,
  });
  for (const r of rows) {
    const s = parseIntelSummary(r.payload);
    if (s) out.set(r.companyId, s);
  }
  return out;
}

/** Open (or extend) the enrichment batch for one import. Returns the batch id. */
export async function openImportBatch(
  db: Db,
  args: {
    orgId: string;
    migrationJobId: string | null;
    origin: 'csv' | 'hubspot';
    companyIds: string[];
    createdById: string | null;
  },
): Promise<string> {
  const ids = [...new Set(args.companyIds)];
  if (!args.migrationJobId) {
    const row = await db.intelImportBatch.create({
      data: {
        orgId: args.orgId,
        origin: args.origin,
        companyIds: ids,
        createdById: args.createdById,
      },
      select: { id: true },
    });
    return row.id;
  }
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO intel_import_batches (id, org_id, migration_job_id, origin, company_ids, created_by_id, updated_at)
    VALUES (gen_random_uuid(), ${args.orgId}::uuid, ${args.migrationJobId}::uuid, ${args.origin}, ${ids}::text[], ${args.createdById}::uuid, now())
    ON CONFLICT (org_id, migration_job_id) DO UPDATE SET
      company_ids = ARRAY(SELECT DISTINCT unnest(intel_import_batches.company_ids || EXCLUDED.company_ids)),
      status = CASE WHEN EXCLUDED.company_ids <@ (intel_import_batches.done_ids || intel_import_batches.failed_ids) THEN intel_import_batches.status ELSE 'running' END,
      completed_at = CASE WHEN EXCLUDED.company_ids <@ (intel_import_batches.done_ids || intel_import_batches.failed_ids) THEN intel_import_batches.completed_at ELSE NULL END,
      updated_at = now()
    RETURNING id::text AS id`;
  return rows[0]!.id;
}

/** Record one company's result; completes the batch with result counts once every company is in. */
export async function markImportBatchCompany(
  db: Db,
  args: { orgId: string; batchId: string; companyId: string; ok: boolean; now?: Date },
): Promise<'running' | 'complete' | 'missing'> {
  const rows = await db.$queryRaw<
    Array<{ company_ids: string[]; done_ids: string[]; failed_ids: string[]; status: string }>
  >`
    UPDATE intel_import_batches SET
      done_ids = CASE WHEN ${args.ok} AND NOT (${args.companyId} = ANY(done_ids)) THEN array_append(done_ids, ${args.companyId}) ELSE done_ids END,
      failed_ids = CASE WHEN ${args.ok} THEN array_remove(failed_ids, ${args.companyId})
                        WHEN NOT (${args.companyId} = ANY(failed_ids)) AND NOT (${args.companyId} = ANY(done_ids)) THEN array_append(failed_ids, ${args.companyId})
                        ELSE failed_ids END,
      updated_at = now()
    WHERE id = ${args.batchId}::uuid AND org_id = ${args.orgId}::uuid
    RETURNING company_ids, done_ids, failed_ids, status`;
  const b = rows[0];
  if (!b) return 'missing';
  const settled = new Set([...b.done_ids, ...b.failed_ids]);
  if (!b.company_ids.every((id) => settled.has(id))) return 'running';
  if (b.status === 'complete') return 'complete';
  const summaries = await readCompanyIntelSummaries(db, args.orgId, b.company_ids);
  const list = [...summaries.values()];
  const summary = {
    withRevenue: list.filter((s) => s.revenue).length,
    withHeadcountGrowth: list.filter((s) => s.headcountGrowth).length,
    withNewRoles30d: list.filter((s) => s.newRoles30d).length,
    withDirection: list.filter((s) => s.direction).length,
  };
  // Completes only if the membership is still the one counted above and every
  // member is settled; a chunk appended meanwhile keeps the batch running.
  const completed = await db.$queryRaw<Array<{ status: string }>>`
    UPDATE intel_import_batches SET
      status = 'complete',
      summary = ${JSON.stringify(summary)}::jsonb,
      completed_at = ${args.now ?? new Date()},
      updated_at = now()
    WHERE id = ${args.batchId}::uuid AND org_id = ${args.orgId}::uuid AND status = 'running'
      AND company_ids = ${b.company_ids}::text[]
      AND company_ids <@ (done_ids || failed_ids)
    RETURNING status`;
  if (completed.length > 0) return 'complete';
  const current = await db.intelImportBatch.findFirst({
    where: { id: args.batchId, orgId: args.orgId },
    select: { status: true },
  });
  return current?.status === 'complete' ? 'complete' : 'running';
}

/** Recent import batches for this org, newest first. */
export async function readImportBatches(
  db: Db,
  orgId: string,
  opts: { since?: Date; limit?: number } = {},
): Promise<IntelImportBatchView[]> {
  const rows = await db.intelImportBatch.findMany({
    where: { orgId, ...(opts.since ? { createdAt: { gte: opts.since } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 5, 20),
  });
  return rows.map((r) =>
    IntelImportBatchView.parse({
      id: r.id,
      migrationJobId: r.migrationJobId,
      origin: r.origin === 'hubspot' ? 'hubspot' : 'csv',
      total: r.companyIds.length,
      done: r.doneIds.length,
      failed: r.failedIds.length,
      status: r.status === 'complete' ? 'complete' : 'running',
      summary: (r.summary ?? {}) as Record<string, number>,
      createdAt: r.createdAt.toISOString(),
      completedAt: iso(r.completedAt),
    }),
  );
}

/** Delete import batches older than the retention window. */
export async function pruneImportBatches(
  db: Db,
  orgId: string,
  now: Date,
  days = 90,
): Promise<number> {
  const res = await db.intelImportBatch.deleteMany({
    where: { orgId, createdAt: { lt: new Date(now.getTime() - days * DAY) } },
  });
  return res.count;
}
