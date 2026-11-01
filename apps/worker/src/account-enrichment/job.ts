/**
 * One account enrichment run (2026-10-31).
 *
 * 1. Cache: skip when the stored row is still inside its TTL (default 7 days),
 *    unless the job says force.
 * 2. Providers in order (Apollo, then Seamless). Seamless is only called when
 *    Apollo left a core field empty, or to finish a research request that an
 *    earlier run left pending (polling is free).
 * 3. Budget: every paid call reserves its credits first. The reservation is a
 *    ledger row written under a per org and provider advisory lock, refused
 *    when the calendar month (UTC) would go over the budget.
 * 4. Merge per field, first provider wins, with {source, fetchedAt} per field.
 *    A field no provider returned this run keeps its old value and provenance.
 * 5. Job postings replace the provider's previous set; then the hiring
 *    breakdown and potential projects are recomputed from all stored postings.
 */
import { prisma, type Prisma } from '@bidstack/db';
import {
  type AccountEnrichmentConfig,
  accountEnrichmentConfigFromEnv,
  type FieldProvenance,
  type HiringRegion,
  type JobFunction,
  type JobSeniority,
  importanceScore,
  type PotentialProject,
  severityFromImportance,
  signalDedupeKey,
} from '@bidstack/shared';

import { buildHiringBreakdown, type ClassifiedPosting, classifyPosting, inferPotentialProjects } from './hiring.js';
import { relabelProjects, resolveProjectLlm, type ProjectLlm } from './projects-llm.js';
import {
  defaultProviders,
  type EnrichmentProvider,
  type EnrichmentProviderId,
  FIRMOGRAPHIC_FIELDS,
  type FirmographicFields,
  type ProviderResult,
  type ProviderSignal,
} from './providers.js';

export type EnrichmentConfig = AccountEnrichmentConfig;

export function enrichmentConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EnrichmentConfig {
  return accountEnrichmentConfigFromEnv(env);
}

export interface EnrichmentDeps {
  providers: EnrichmentProvider[];
  config: EnrichmentConfig;
  now: () => Date;
  projectLlm: (orgId: string) => Promise<ProjectLlm | null>;
}

export function defaultEnrichmentDeps(env: NodeJS.ProcessEnv = process.env): EnrichmentDeps {
  return {
    providers: defaultProviders({ env }),
    config: enrichmentConfigFromEnv(env),
    now: () => new Date(),
    projectLlm: resolveProjectLlm,
  };
}

const CORE_FIELDS: (keyof FirmographicFields)[] = ['annualRevenueUsd', 'employeeCount', 'industry', 'locations', 'techStack'];

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function creditsUsedThisMonth(orgId: string, provider: EnrichmentProviderId, now: Date): Promise<number> {
  const agg = await prisma.enrichmentCreditUsage.aggregate({
    where: { orgId, provider, at: { gte: monthStart(now) } },
    _sum: { credits: true },
  });
  return agg._sum.credits ?? 0;
}

/** Writes the ledger row before the call; false when the budget would be exceeded. */
export async function reserveCredits(args: {
  orgId: string;
  provider: EnrichmentProviderId;
  operation: string;
  credits: number;
  companyId: string;
  budget: number;
  now: Date;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`enrichment:${args.orgId}:${args.provider}`}))`;
    const agg = await tx.enrichmentCreditUsage.aggregate({
      where: { orgId: args.orgId, provider: args.provider, at: { gte: monthStart(args.now) } },
      _sum: { credits: true },
    });
    if ((agg._sum.credits ?? 0) + args.credits > args.budget) return false;
    await tx.enrichmentCreditUsage.create({
      data: {
        orgId: args.orgId,
        provider: args.provider,
        operation: args.operation,
        credits: args.credits,
        companyId: args.companyId,
        at: args.now,
      },
    });
    return true;
  });
}

type StoredStatus = { status: string; credits: number; at: string; error?: string; pendingRequestId?: string };

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

export function mergeFields(
  results: ProviderResult[],
  previous: { values: FirmographicFields; provenance: Record<string, FieldProvenance> },
  fetchedAt: string,
): { values: FirmographicFields; provenance: Record<string, FieldProvenance> } {
  const values: Record<string, unknown> = { ...previous.values };
  const provenance: Record<string, FieldProvenance> = { ...previous.provenance };
  for (const field of FIRMOGRAPHIC_FIELDS) {
    const hit = results.find((r) => hasValue(r.fields[field]));
    if (!hit) continue;
    values[field] = hit.fields[field];
    provenance[field] = { source: hit.provider, fetchedAt };
  }
  return { values: values as FirmographicFields, provenance };
}

function overallStatus(results: ProviderResult[], values: FirmographicFields): string {
  const statuses = results.map((r) => r.status);
  if (statuses.includes('ok')) return CORE_FIELDS.every((f) => hasValue(values[f])) ? 'ok' : 'partial';
  // Fields arrived but a later call stopped (postings budget, postings error).
  if (results.some((r) => Object.keys(r.fields).length > 0)) return 'partial';
  if (statuses.includes('pending')) return 'pending';
  if (statuses.includes('budget_exceeded')) return 'budget_exceeded';
  if (statuses.includes('rate_limited')) return 'rate_limited';
  if (statuses.includes('error')) return 'error';
  if (statuses.every((s) => s === 'not_configured')) return 'not_configured';
  if (statuses.every((s) => s === 'not_configured' || s === 'no_domain')) return 'no_domain';
  return 'not_found';
}

function storedValues(row: Record<string, unknown> | null): FirmographicFields {
  if (!row) return {};
  const v: Record<string, unknown> = {};
  const map: Record<string, unknown> = {
    annualRevenueUsd: row.annualRevenueUsd === null || row.annualRevenueUsd === undefined ? undefined : Number(row.annualRevenueUsd),
    revenueRange: row.revenueRange,
    employeeCount: row.employeeCount,
    employeeRange: row.employeeRange,
    headcountGrowth6m: row.headcountGrowth6m,
    headcountGrowth12m: row.headcountGrowth12m,
    headcountGrowth24m: row.headcountGrowth24m,
    industry: row.industry,
    industries: row.industries,
    locations: row.locations,
    techStack: row.techStack,
    departmentHeadcount: row.departmentHeadcount,
  };
  for (const [k, val] of Object.entries(map)) if (hasValue(val)) v[k] = val;
  return v as FirmographicFields;
}

export function toClassified(row: {
  id: string;
  source: string;
  title: string;
  url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  region: string;
  function: string;
  seniority: string;
  skills: string[];
  postedAt: Date | null;
  lastSeenAt: Date | null;
}): ClassifiedPosting {
  return {
    id: row.id,
    source: row.source as EnrichmentProviderId,
    title: row.title,
    url: row.url,
    city: row.city,
    state: row.state,
    country: row.country,
    postedAt: row.postedAt,
    lastSeenAt: row.lastSeenAt,
    region: row.region as HiringRegion,
    function: row.function as JobFunction,
    seniority: row.seniority as JobSeniority,
    skills: row.skills,
    architect: /\barchitect\b/i.test(row.title),
  };
}

function dateOrNull(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

export class EnrichmentRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number | undefined) {
    super('enrichment providers rate limited');
  }
}

export interface EnrichmentRunResult {
  outcome: 'skipped_fresh' | 'company_not_found' | 'refreshed';
  status?: string;
  credits?: number;
  postings?: number;
  projects?: number;
}

export async function runAccountEnrichment(
  job: { orgId: string; companyId: string; force?: boolean; requestedById?: string | null },
  deps: EnrichmentDeps,
): Promise<EnrichmentRunResult> {
  const now = deps.now();
  const company = await prisma.company.findFirst({
    where: { id: job.companyId, orgId: job.orgId },
    select: { id: true, name: true, domain: true, website: true },
  });
  if (!company) return { outcome: 'company_not_found' };
  const existing = await prisma.companyFirmographics.findUnique({ where: { companyId: company.id } });
  if (existing && existing.orgId !== job.orgId) return { outcome: 'company_not_found' };
  const prevStatus = rec(existing?.providerStatus) as Record<string, StoredStatus>;
  const anyPending = Object.values(prevStatus).some((s) => Boolean(rec(s).pendingRequestId));
  if (!job.force && existing?.expiresAt && existing.expiresAt > now && !anyPending) {
    return { outcome: 'skipped_fresh', status: existing.status };
  }

  const fetchedAt = now.toISOString();
  const results: ProviderResult[] = [];
  const domain = company.domain ?? company.website ?? null;
  for (const provider of deps.providers) {
    const pendingRequestId = rec(prevStatus[provider.id]).pendingRequestId as string | undefined;
    const gathered = mergeFields(results, { values: {}, provenance: {} }, fetchedAt).values;
    const coreMissing = CORE_FIELDS.some((f) => !hasValue(gathered[f]));
    if (results.length > 0 && !coreMissing && !pendingRequestId) continue;
    const result = await provider.enrich(
      { name: company.name, domain, pendingRequestId: pendingRequestId ?? null },
      {
        maxJobPages: provider.id === 'apollo' ? deps.config.maxJobPages : 0,
        reserve: (operation, credits) =>
          reserveCredits({
            orgId: job.orgId,
            provider: provider.id,
            operation,
            credits,
            companyId: company.id,
            budget: deps.config.monthlyBudget[provider.id],
            now,
          }),
      },
    );
    results.push(result);
  }

  const merged = mergeFields(
    results,
    { values: storedValues(existing as unknown as Record<string, unknown> | null), provenance: rec(existing?.provenance) as Record<string, FieldProvenance> },
    fetchedAt,
  );
  const status = overallStatus(results, merged.values);
  if (status === 'rate_limited') {
    throw new EnrichmentRateLimitedError(results.find((r) => r.retryAfterMs !== undefined)?.retryAfterMs);
  }

  // Job postings: replace each provider's set when it returned one.
  for (const r of results) {
    if (!r.jobPostings) continue;
    const keep = r.jobPostings.slice(0, 1000);
    await prisma.$transaction(async (tx) => {
      await tx.companyJobPosting.deleteMany({
        where: { orgId: job.orgId, companyId: company.id, source: r.provider, externalId: { notIn: keep.map((p) => p.externalId) } },
      });
      for (const p of keep) {
        const c = classifyPosting({ ...p, id: p.externalId, source: r.provider });
        const data = {
          title: p.title.slice(0, 300),
          url: p.url,
          city: p.city,
          state: p.state,
          country: p.country,
          region: c.region,
          function: c.function,
          seniority: c.seniority,
          skills: c.skills,
          postedAt: dateOrNull(p.postedAt),
          lastSeenAt: dateOrNull(p.lastSeenAt),
          fetchedAt: now,
        };
        await tx.companyJobPosting.upsert({
          where: { orgId_companyId_source_externalId: { orgId: job.orgId, companyId: company.id, source: r.provider, externalId: p.externalId } },
          create: { orgId: job.orgId, companyId: company.id, source: r.provider, externalId: p.externalId, ...data },
          update: data,
        });
      }
    });
  }
  const postings = (
    await prisma.companyJobPosting.findMany({
      where: { orgId: job.orgId, companyId: company.id },
      orderBy: { postedAt: 'desc' },
      take: 1000,
    })
  ).map(toClassified);
  const hiring = buildHiringBreakdown(postings);
  let projects: PotentialProject[] = inferPotentialProjects(postings, now);
  if (projects.length) projects = await relabelProjects(projects, await deps.projectLlm(job.orgId).catch(() => null));

  const providerStatus: Record<string, StoredStatus> = { ...prevStatus };
  const providerIds = { ...rec(existing?.providerIds) };
  for (const r of results) {
    providerStatus[r.provider] = {
      status: r.status,
      credits: r.creditsUsed,
      at: fetchedAt,
      ...(r.error ? { error: r.error } : {}),
      ...(r.pendingRequestId && r.status === 'pending' ? { pendingRequestId: r.pendingRequestId } : {}),
    };
    if (r.providerCompanyId) providerIds[r.provider] = r.providerCompanyId;
    if (r.linkedinUrl) providerIds.linkedin_url = r.linkedinUrl;
  }
  const fresh = status === 'ok' || status === 'partial';
  const v = merged.values;
  const data = {
    status,
    annualRevenueUsd: v.annualRevenueUsd === undefined ? null : BigInt(Math.round(v.annualRevenueUsd)),
    revenueRange: v.revenueRange ?? null,
    employeeCount: v.employeeCount ?? null,
    employeeRange: v.employeeRange ?? null,
    headcountGrowth6m: v.headcountGrowth6m ?? null,
    headcountGrowth12m: v.headcountGrowth12m ?? null,
    headcountGrowth24m: v.headcountGrowth24m ?? null,
    industry: v.industry ?? null,
    industries: v.industries ?? [],
    locations: (v.locations ?? []) as unknown as Prisma.InputJsonValue,
    techStack: v.techStack ?? [],
    departmentHeadcount: (v.departmentHeadcount ?? undefined) as Prisma.InputJsonValue | undefined,
    providerIds: providerIds as Prisma.InputJsonValue,
    provenance: merged.provenance as unknown as Prisma.InputJsonValue,
    providerStatus: providerStatus as unknown as Prisma.InputJsonValue,
    hiring: hiring as unknown as Prisma.InputJsonValue,
    projects: projects as unknown as Prisma.InputJsonValue,
    fetchedAt: fresh ? now : (existing?.fetchedAt ?? null),
    expiresAt: fresh ? new Date(now.getTime() + deps.config.ttlDays * 86_400_000) : null,
    requestedById: job.requestedById ?? null,
  };
  await prisma.companyFirmographics.upsert({
    where: { companyId: company.id },
    create: { orgId: job.orgId, companyId: company.id, ...data },
    update: data,
  });
  await saveProviderSignals(job.orgId, company.id, company.name, results.flatMap((r) => r.signals ?? [])).catch(() => undefined);
  return {
    outcome: 'refreshed',
    status,
    credits: results.reduce((n, r) => n + r.creditsUsed, 0),
    postings: postings.length,
    projects: projects.length,
  };
}

/** Companies whose data expired (or never ran), oldest first. Used by the opt-in sweep. */
export async function dueCompanies(limit: number, now: Date): Promise<Array<{ orgId: string; companyId: string }>> {
  const rows = await prisma.company.findMany({
    where: {
      OR: [{ domain: { not: null } }, { website: { not: null } }],
      AND: [{ OR: [{ firmographics: { is: null } }, { firmographics: { expiresAt: { lt: now } } }] }],
      keyAccountOwnerId: { not: null },
    },
    select: { id: true, orgId: true },
    orderBy: { updatedAt: 'asc' },
    take: Math.min(Math.max(limit, 0), 1000),
  });
  return rows.map((r) => ({ orgId: r.orgId, companyId: r.id }));
}

/**
 * Provider company events (Apollo funding today) become watch events, insert
 * only, so a dismissed one stays dismissed. Scored with the shared rules.
 */
export async function saveProviderSignals(orgId: string, companyId: string, companyName: string, signals: ProviderSignal[]): Promise<number> {
  if (!signals.length) return 0;
  const res = await prisma.accountWatchEvent.createMany({
    skipDuplicates: true,
    data: signals.map((s) => {
      const importance = importanceScore({ kind: s.kind, implication: 'OPPORTUNITY', source: s.provider });
      return {
        orgId,
        companyId,
        source: s.provider,
        externalId: s.externalId,
        kind: s.kind,
        occurredAt: new Date(s.occurredAt),
        title: s.title,
        sourceUrl: s.url ?? '',
        summary: s.summary,
        implication: 'OPPORTUNITY' as const,
        implicationRationale: 'New money usually funds hiring and projects in the next two quarters.',
        severity: severityFromImportance(importance),
        importance,
        sentiment: 0.8,
        dedupeKey: signalDedupeKey(s.kind, s.title, companyName),
        payload: { provider: s.provider } as Prisma.InputJsonValue,
      };
    }),
  });
  return res.count;
}
