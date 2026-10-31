// Account enrichment: firmographics, hiring breakdown and "Potential projects"
// per CRM company, from Apollo (first) and Seamless (second). The worker
// fetches and derives (apps/worker/src/account-enrichment); these routes read.
// Contract: fleet/polo-enrichment-api.md.
//
// Security model
//  * RBAC: companies:read for every read (firmographics, hiring, projects,
//    watchdog signals, credit usage). companies:write to queue a refresh,
//    since a refresh spends provider credits.
//  * Org + scope isolation: the company must be in the caller's org and access
//    scope (applyCompanyScope). Misses answer 404. The signals feed only lists
//    in-scope companies.
//  * Audit: every read and refresh writes audit_log (targetType company).
//  * Provider keys never pass through the API: the worker reads them from env.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { type Prisma, prisma } from '@bidstack/db';
import {
  accountEnrichmentConfigFromEnv,
  EnrichmentOpportunitySignal,
  EnrichmentProviderId,
  type FieldProvenance,
  Firmographics,
  HiringBreakdown,
  HiringRegion,
  JobFunction,
  JobSeniority,
  PotentialProject,
  ProjectConfidence,
} from '@bidstack/shared';

import { applyCompanyScope, getAccessScope } from '../lib/access-scope.js';
import { enqueueAccountEnrichment } from '../queues/account-enrichment.js';

const idParam = z.object({ id: z.string().uuid() });
const EMPTY_HIRING: HiringBreakdown = { total: 0, byFunction: [], bySeniority: [], byRegion: [], topSkills: [], clusters: [] };
const CONF_RANK: Record<ProjectConfidence, number> = { high: 0, medium: 1, low: 2 };

async function audit(req: FastifyRequest, action: string, targetId: string | null, diff: Record<string, unknown> = {}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      orgId: req.auth.orgId,
      userId: req.auth.userId,
      action,
      targetType: 'company',
      targetId,
      diff: diff as Prisma.InputJsonValue,
    },
  });
}

/** The company if it is in the caller's org and scope, else null (404). */
async function loadCompany(req: FastifyRequest, id: string): Promise<{ id: string; name: string } | null> {
  const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
  return prisma.company.findFirst({
    where: applyCompanyScope({ id, orgId: req.auth.orgId, deletedAt: null }, scope),
    select: { id: true, name: true },
  });
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.companyFirmographics.findUnique>>>;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseProjects(v: unknown): PotentialProject[] {
  const out = z.array(PotentialProject).safeParse(v);
  return out.success ? out.data : [];
}

function parseHiring(v: unknown): HiringBreakdown {
  const out = HiringBreakdown.safeParse(v);
  return out.success ? out.data : EMPTY_HIRING;
}

function toFirmographics(companyId: string, row: Row | null, openJobs: number, now: Date): Firmographics {
  const providers: Firmographics['providers'] = {};
  for (const [k, s] of Object.entries(rec(row?.providerStatus))) {
    const r = rec(s);
    providers[k] = {
      status: String(r.status ?? 'unknown'),
      credits: Number(r.credits ?? 0),
      at: String(r.at ?? ''),
      ...(typeof r.error === 'string' ? { error: r.error } : {}),
    };
  }
  const locations = z
    .array(z.object({ city: z.string().nullable(), state: z.string().nullable(), country: z.string().nullable(), kind: z.enum(['hq', 'subsidiary']) }))
    .safeParse(row?.locations ?? []);
  const dept = rec(row?.departmentHeadcount);
  return {
    companyId,
    status: row?.status ?? 'not_enriched',
    annualRevenueUsd: row?.annualRevenueUsd === null || row?.annualRevenueUsd === undefined ? null : Number(row.annualRevenueUsd),
    revenueRange: row?.revenueRange ?? null,
    employeeCount: row?.employeeCount ?? null,
    employeeRange: row?.employeeRange ?? null,
    headcountGrowth6m: row?.headcountGrowth6m ?? null,
    headcountGrowth12m: row?.headcountGrowth12m ?? null,
    headcountGrowth24m: row?.headcountGrowth24m ?? null,
    industry: row?.industry ?? null,
    industries: row?.industries ?? [],
    locations: locations.success ? locations.data : [],
    techStack: row?.techStack ?? [],
    departmentHeadcount: Object.keys(dept).length
      ? Object.fromEntries(Object.entries(dept).filter((e): e is [string, number] => typeof e[1] === 'number'))
      : null,
    openJobs,
    provenance: rec(row?.provenance) as Record<string, FieldProvenance>,
    providers,
    fetchedAt: row?.fetchedAt?.toISOString() ?? null,
    expiresAt: row?.expiresAt?.toISOString() ?? null,
    stale: !row?.expiresAt || row.expiresAt <= now,
  };
}

const Posting = z.object({
  id: z.string(),
  source: EnrichmentProviderId,
  title: z.string(),
  url: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  region: HiringRegion,
  function: JobFunction,
  seniority: JobSeniority,
  skills: z.array(z.string()),
  postedAt: z.string().nullable(),
});

const HiringResponse = z.object({
  companyId: z.string().uuid(),
  fetchedAt: z.string().nullable(),
  hiring: HiringBreakdown,
  postings: z.array(Posting),
  postingsTotal: z.number().int(),
});

const HiringQuery = z.object({
  function: JobFunction.optional(),
  region: HiringRegion.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const ProjectsResponse = z.object({
  companyId: z.string().uuid(),
  fetchedAt: z.string().nullable(),
  projects: z.array(PotentialProject),
});

const ProjectsQuery = z.object({ minConfidence: ProjectConfidence.default('low') });

const RefreshBody = z.object({ force: z.boolean().optional() }).nullish();
const RefreshResponse = z.object({
  queued: z.boolean(),
  jobId: z.string().nullable(),
  status: z.string(),
  expiresAt: z.string().nullable(),
});

const SignalsQuery = z.object({
  minConfidence: ProjectConfidence.default('medium'),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const SignalsResponse = z.object({ items: z.array(EnrichmentOpportunitySignal) });

const UsageResponse = z.object({
  month: z.string(),
  ttlDays: z.number().int(),
  providers: z.array(z.object({ provider: EnrichmentProviderId, used: z.number().int(), budget: z.number().int(), remaining: z.number().int() })),
});

export const accountEnrichmentRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/companies/:id/enrichment',
    { config: { permission: 'companies:read' }, schema: { params: idParam, response: { 200: Firmographics } } },
    async (req) => {
      const company = await loadCompany(req, req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const [row, openJobs] = await Promise.all([
        prisma.companyFirmographics.findUnique({ where: { companyId: company.id } }),
        prisma.companyJobPosting.count({ where: { orgId: req.auth.orgId, companyId: company.id } }),
      ]);
      await audit(req, 'enrichment.view', company.id, { status: row?.status ?? 'not_enriched' });
      return toFirmographics(company.id, row && row.orgId === req.auth.orgId ? row : null, openJobs, new Date());
    },
  );

  server.get(
    '/companies/:id/enrichment/hiring',
    { config: { permission: 'companies:read' }, schema: { params: idParam, querystring: HiringQuery, response: { 200: HiringResponse } } },
    async (req) => {
      const company = await loadCompany(req, req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const orgId = req.auth.orgId;
      const where: Prisma.CompanyJobPostingWhereInput = {
        orgId,
        companyId: company.id,
        ...(req.query.function ? { function: req.query.function } : {}),
        ...(req.query.region ? { region: req.query.region } : {}),
      };
      const [row, rows, total] = await Promise.all([
        prisma.companyFirmographics.findFirst({ where: { orgId, companyId: company.id }, select: { hiring: true, fetchedAt: true } }),
        prisma.companyJobPosting.findMany({ where, orderBy: [{ postedAt: 'desc' }, { title: 'asc' }], take: req.query.limit }),
        prisma.companyJobPosting.count({ where }),
      ]);
      await audit(req, 'enrichment.hiring.view', company.id, { function: req.query.function ?? null, region: req.query.region ?? null });
      return {
        companyId: company.id,
        fetchedAt: row?.fetchedAt?.toISOString() ?? null,
        hiring: parseHiring(row?.hiring),
        postingsTotal: total,
        postings: rows.map((p) => ({
          id: p.id,
          source: p.source as EnrichmentProviderId,
          title: p.title,
          url: p.url,
          city: p.city,
          country: p.country,
          region: p.region as HiringRegion,
          function: p.function as JobFunction,
          seniority: p.seniority as JobSeniority,
          skills: p.skills,
          postedAt: p.postedAt?.toISOString() ?? null,
        })),
      };
    },
  );

  server.get(
    '/companies/:id/enrichment/projects',
    { config: { permission: 'companies:read' }, schema: { params: idParam, querystring: ProjectsQuery, response: { 200: ProjectsResponse } } },
    async (req) => {
      const company = await loadCompany(req, req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const row = await prisma.companyFirmographics.findFirst({
        where: { orgId: req.auth.orgId, companyId: company.id },
        select: { projects: true, fetchedAt: true },
      });
      const max = CONF_RANK[req.query.minConfidence];
      const projects = parseProjects(row?.projects).filter((p) => CONF_RANK[p.confidence] <= max);
      await audit(req, 'enrichment.projects.view', company.id, { count: projects.length });
      return { companyId: company.id, fetchedAt: row?.fetchedAt?.toISOString() ?? null, projects };
    },
  );

  server.post(
    '/companies/:id/enrichment/refresh',
    { config: { permission: 'companies:write' }, schema: { params: idParam, body: RefreshBody, response: { 202: RefreshResponse } } },
    async (req, reply) => {
      const company = await loadCompany(req, req.params.id);
      if (!company) throw server.httpErrors.notFound('Company not found');
      const force = req.body?.force ?? false;
      const row = await prisma.companyFirmographics.findFirst({
        where: { orgId: req.auth.orgId, companyId: company.id },
        select: { status: true, expiresAt: true },
      });
      const jobId = await enqueueAccountEnrichment({
        kind: 'enrich',
        orgId: req.auth.orgId,
        companyId: company.id,
        force,
        requestedById: req.auth.userId,
      });
      await audit(req, 'enrichment.refresh', company.id, { force, queued: jobId !== null });
      reply.code(202);
      return {
        queued: jobId !== null,
        jobId,
        status: row?.status ?? 'not_enriched',
        expiresAt: row?.expiresAt?.toISOString() ?? null,
      };
    },
  );

  // Watchdog feed: potential projects as opportunity signals, in-scope accounts only.
  server.get(
    '/enrichment/signals',
    { config: { permission: 'companies:read' }, schema: { querystring: SignalsQuery, response: { 200: SignalsResponse } } },
    async (req) => {
      const orgId = req.auth.orgId;
      const scope = await getAccessScope(orgId, req.auth.userId);
      const rows = await prisma.companyFirmographics.findMany({
        where: {
          orgId,
          company: applyCompanyScope({ orgId, deletedAt: null }, scope),
          ...(req.query.since ? { fetchedAt: { gte: new Date(req.query.since) } } : {}),
        },
        select: { companyId: true, projects: true, fetchedAt: true, company: { select: { name: true } } },
        orderBy: { fetchedAt: 'desc' },
        take: 500,
      });
      const max = CONF_RANK[req.query.minConfidence];
      const items: EnrichmentOpportunitySignal[] = [];
      for (const r of rows) {
        for (const p of parseProjects(r.projects)) {
          if (CONF_RANK[p.confidence] > max) continue;
          items.push({
            kind: 'enrichment.potential_project',
            companyId: r.companyId,
            companyName: r.company.name,
            projectId: p.id,
            title: p.name,
            detail: p.rationale,
            confidence: p.confidence,
            evidenceUrls: p.evidence.map((e) => e.url).filter((u): u is string => Boolean(u)).slice(0, 5),
            observedAt: r.fetchedAt?.toISOString() ?? new Date(0).toISOString(),
          });
        }
      }
      items.sort((a, b) => CONF_RANK[a.confidence] - CONF_RANK[b.confidence] || b.observedAt.localeCompare(a.observedAt));
      const page = items.slice(0, req.query.limit);
      await audit(req, 'enrichment.signals.list', null, { count: page.length, minConfidence: req.query.minConfidence });
      return { items: page };
    },
  );

  server.get(
    '/enrichment/usage',
    { config: { permission: 'companies:read' }, schema: { response: { 200: UsageResponse } } },
    async (req) => {
      const cfg = accountEnrichmentConfigFromEnv(process.env);
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const sums = await prisma.enrichmentCreditUsage.groupBy({
        by: ['provider'],
        where: { orgId: req.auth.orgId, at: { gte: start } },
        _sum: { credits: true },
      });
      const used = (p: string): number => sums.find((s) => s.provider === p)?._sum.credits ?? 0;
      await audit(req, 'enrichment.usage.view', null);
      return {
        month: start.toISOString().slice(0, 7),
        ttlDays: cfg.ttlDays,
        providers: (['apollo', 'seamless'] as const).map((provider) => ({
          provider,
          used: used(provider),
          budget: cfg.monthlyBudget[provider],
          remaining: Math.max(0, cfg.monthlyBudget[provider] - used(provider)),
        })),
      };
    },
  );
};
