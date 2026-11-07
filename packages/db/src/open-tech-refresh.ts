/**
 * Open data technology stack refresh for one account (slice 16), shared by the
 * API refresh route and the worker (create, import and weekly sweep).
 *
 * Runs the shared detector (DNS, certificate transparency, homepage, stored
 * public job postings, GitHub), merges the run into
 * CompanyEnrichment.providerMetadata.openTechStack without touching any other
 * provider key, then decides on Apollo: organization enrichment is queued only
 * when open lanes find fewer than APOLLO_FALLBACK_THRESHOLD technologies and an
 * Apollo key or MCP lane is configured. Never people, contact, email or phone
 * data.
 */
import {
  APOLLO_FALLBACK_THRESHOLD,
  coverageFromSnapshot,
  mergeOpenTechSnapshot,
  needsApolloFallback,
  openTechItemCount,
  parseOpenTechSnapshot,
  type OpenTechStackSnapshot,
  type TechnicalStackCoverage,
} from '@bidstack/shared';
import { detectOpenTechStack, techDetectUserAgent, type TechDetectDeps } from '@bidstack/shared/server';

import type { PrismaClient } from '../generated/client/index.js';

export type ApolloFallbackDecision = NonNullable<TechnicalStackCoverage['apolloFallback']>;

export interface OpenTechApolloJob {
  orgId: string;
  companyName: string;
  domain?: string;
  orgOnly: true;
}

export interface OpenTechRefreshResult {
  snapshot: OpenTechStackSnapshot;
  coverage: TechnicalStackCoverage;
  apolloFallback: ApolloFallbackDecision;
  apolloJobId: string | null;
  stored: boolean;
}

interface RefreshLog {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

/** Same rule as the API and the Apollo worker, so rows written here are found there. */
export function normalizeEnrichmentName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Network lanes run everywhere except tests and environments that turn open enrichment off. */
export function openTechNetworkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'test' && env.BIDSTACK_OPEN_ENRICHMENT_DISABLED !== '1';
}

/** Apollo organization enrichment is reachable: MCP lane, or API key plus a domain. Keys are read by name only. */
export function apolloOrgEnrichmentConfigured(domain: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const mcp = Boolean(env.APOLLO_MCP_URL?.trim() && env.APOLLO_MCP_BEARER_TOKEN?.trim());
  const api = Boolean(env.APOLLO_API_KEY?.trim() && domain?.trim());
  return mcp || api;
}

export async function loadOpenTechCoverage(prisma: PrismaClient, orgId: string, companyName: string): Promise<TechnicalStackCoverage | null> {
  const row = await prisma.companyEnrichment.findFirst({
    where: { orgId, normalizedName: normalizeEnrichmentName(companyName), deletedAt: null },
    select: { providerMetadata: true },
  });
  const metadata = (row?.providerMetadata ?? {}) as Record<string, unknown>;
  return coverageFromSnapshot(parseOpenTechSnapshot(metadata.openTechStack));
}

export async function refreshCompanyOpenTechStack({
  prisma,
  orgId,
  companyName,
  domain,
  website,
  log,
  enqueueApollo,
  deps,
  createIfMissing = false,
  laneTimeoutMs = 9_000,
  env = process.env,
}: {
  prisma: PrismaClient;
  orgId: string;
  companyName: string;
  domain: string | null;
  website: string | null;
  log: RefreshLog;
  enqueueApollo: (job: OpenTechApolloJob) => Promise<string | null>;
  deps?: TechDetectDeps | null;
  /** Worker runs create a bare enrichment row so the result has somewhere to live. */
  createIfMissing?: boolean;
  laneTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<OpenTechRefreshResult> {
  const normalizedName = normalizeEnrichmentName(companyName);
  const [company, enrichment] = await Promise.all([
    prisma.company.findFirst({
      where: { orgId, deletedAt: null, name: { equals: companyName.trim(), mode: 'insensitive' } },
      select: { id: true },
    }),
    prisma.companyEnrichment.findFirst({
      where: { orgId, normalizedName, deletedAt: null },
      select: { id: true, providerMetadata: true },
    }),
  ]);
  const postings = company
    ? await prisma.companyJobPosting.findMany({
        where: { orgId, companyId: company.id },
        select: { title: true, department: true, skills: true, url: true, fetchedAt: true },
        orderBy: { fetchedAt: 'desc' },
        take: 300,
      })
    : [];
  const metadata = (enrichment?.providerMetadata ?? {}) as Record<string, unknown>;
  const previous = parseOpenTechSnapshot(metadata.openTechStack);
  const githubOrg = typeof metadata.githubOrg === 'string' ? metadata.githubOrg : null;

  const run = await detectOpenTechStack(
    { name: companyName, domain, website, githubOrg, postings },
    {
      network: openTechNetworkEnabled(env),
      userAgent: techDetectUserAgent(env),
      laneTimeoutMs,
      ...(deps ?? {}),
    },
  );
  const merged = mergeOpenTechSnapshot(previous?.sample ? null : previous, run);
  const openItems = openTechItemCount(merged);

  let apolloFallback: ApolloFallbackDecision = 'not_needed';
  let apolloJobId: string | null = null;
  if (needsApolloFallback(openItems)) {
    if (!apolloOrgEnrichmentConfigured(domain, env)) {
      apolloFallback = 'not_configured';
    } else {
      apolloJobId = await enqueueApollo({ orgId, companyName, ...(domain ? { domain } : {}), orgOnly: true }).catch((err: unknown) => {
        log.warn({ err, company: companyName }, 'apollo fallback enqueue failed');
        return null;
      });
      apolloFallback = apolloJobId ? 'queued' : 'unavailable';
    }
  }
  const snapshot: OpenTechStackSnapshot = { ...merged, apolloFallback };
  const githubFound = run.githubOrg && run.githubOrg !== githubOrg ? run.githubOrg : null;

  let stored = Boolean(enrichment);
  if (!enrichment && createIfMissing) {
    const created = await prisma.companyEnrichment.createMany({
      data: [{ orgId, normalizedName, legalName: companyName.trim(), domain, website }],
      skipDuplicates: true,
    });
    stored = created.count > 0 || (await prisma.companyEnrichment.count({ where: { orgId, normalizedName, deletedAt: null } })) > 0;
  }
  if (stored) {
    // One key at a time: concurrent Apollo or Seamless writes keep their keys.
    const value = JSON.stringify(snapshot);
    await prisma.$executeRaw`
      UPDATE company_enrichments
      SET provider_metadata = jsonb_set(COALESCE(provider_metadata, '{}'::jsonb), '{openTechStack}', ${value}::jsonb, true),
          updated_at = NOW()
      WHERE org_id = ${orgId}::uuid AND normalized_name = ${normalizedName} AND deleted_at IS NULL`;
    if (githubFound) {
      await prisma.$executeRaw`
        UPDATE company_enrichments
        SET provider_metadata = jsonb_set(provider_metadata, '{githubOrg}', to_jsonb(${githubFound}::text), true)
        WHERE org_id = ${orgId}::uuid AND normalized_name = ${normalizedName} AND deleted_at IS NULL`;
    }
  } else {
    log.info({ company: companyName }, 'open tech stack not stored: no enrichment row yet');
  }

  log.info(
    {
      company: companyName,
      openItems,
      apolloFallback,
      lanes: Object.fromEntries(snapshot.lanes.map((l) => [l.lane, `${l.status}:${l.count}`])),
    },
    'open data tech stack refreshed',
  );
  return {
    snapshot,
    coverage: coverageFromSnapshot(snapshot, APOLLO_FALLBACK_THRESHOLD)!,
    apolloFallback,
    apolloJobId,
    stored,
  };
}
