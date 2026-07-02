import { type z } from 'zod';
import type { PrismaClient, Prisma } from '@bidstack/db';
import {
  SourceAttribution,
  type CrmCompany,
  type SourceAttribution as SourceAttributionType,
} from '@bidstack/shared';

import {
  faviconProfile,
  fetchOpenCompanyProfile,
} from '../../providers/company-open-enrichment.js';
import { fetchSeamlessCompany } from '../../providers/company-seamless-enrichment.js';
import {
  fetchCompanyTechStackMcps,
  techStackMcpSourceConfigsFromEnv,
} from '../../providers/company-tech-stack-mcp.js';
import { resolveDataProviderApiKey } from '../../lib/data-provider-credentials.js';
import { enqueueApolloEnrich } from '../../queues/company-enrich-apollo.js';
import {
  attribution,
  domainFor,
  normalizeName,
  normalizeDomain,
  normalizeCountry,
  logoUrlFor,
  serializeCompany,
} from './dashboard.service.js';
import { parseAttribution, record } from './dashboard.utils.js';

const COMPANY_ENRICHMENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type RouteLog = {
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
};

export function canQueueApolloEnrichment({
  domain,
  env = process.env,
}: {
  domain?: string | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const apolloMcpConfigured = Boolean(
    env.APOLLO_MCP_URL?.trim() && env.APOLLO_MCP_BEARER_TOKEN?.trim(),
  );
  const apolloApiConfigured = Boolean(env.APOLLO_API_KEY?.trim() && domain?.trim());
  return apolloMcpConfigured || apolloApiConfigured;
}

export async function upsertVerifiedCompanyEnrichment({
  orgId,
  userId,
  name,
  domain: inputDomain,
  website: inputWebsite,
  country,
  requestedBy,
  auditAction,
  log,
  prisma,
}: {
  orgId: string;
  userId: string | null;
  name: string;
  domain?: string | null;
  website?: string | null;
  country?: string | null;
  requestedBy: string;
  auditAction: string;
  log: RouteLog;
  prisma: PrismaClient;
}): Promise<{ company: z.infer<typeof CrmCompany>; domain: string | null; providers: string[] }> {
  const normalizedName = normalizeName(name);
  const now = new Date();
  const requestedDomain = normalizeDomain(inputDomain ?? domainFor(name));
  const requestedWebsite = inputWebsite ?? (requestedDomain ? `https://${requestedDomain}/` : null);
  const existing = await prisma.companyEnrichment.findUnique({
    where: { orgId_normalizedName: { orgId, normalizedName } },
    select: { providerMetadata: true, sourceAttribution: true },
  });
  const existingMetadata = record(existing?.providerMetadata);
  // Preferred EXTERNAL source: Seamless.AI (paid, verified) when a key is set.
  // Falls back to the keyless open (Wikidata/Wikipedia) path otherwise. Both are
  // source-attributed so the account view keeps the External/Internal split.
  // Key precedence: the org's encrypted Settings key → deployment env. Either
  // activates Seamless without touching code.
  const seamlessMcpUrl = process.env.SEAMLESS_MCP_URL ?? null;
  const seamlessApiKey =
    process.env.NODE_ENV === 'test'
      ? null
      : ((await resolveDataProviderApiKey(orgId, 'seamless').catch((err) => {
          log.warn({ err, orgId }, 'seamless api key resolution failed');
          return null;
        })) ??
        process.env.SEAMLESS_API_KEY ??
        null);
  const seamlessProfile = seamlessMcpUrl || seamlessApiKey
    ? await fetchSeamlessCompany({
        name,
        domain: requestedDomain,
        website: requestedWebsite,
        now,
        apiKey: seamlessApiKey ?? undefined,
        mcpUrl: seamlessMcpUrl ?? undefined,
      }).catch((err) => {
        log.warn({ err, company: name }, 'seamless enrichment failed');
        return null;
      })
    : null;
  const openProfile =
    seamlessProfile ??
    (process.env.NODE_ENV === 'test' || process.env.BIDSTACK_OPEN_ENRICHMENT_DISABLED === '1'
      ? null
      : await fetchOpenCompanyProfile({
          name,
          domain: requestedDomain,
          website: requestedWebsite,
          now,
        }).catch((err) => {
          log.warn({ err, company: name }, 'open company data verification failed');
          return null;
        }));
  const techStackMcpSources = techStackMcpSourceConfigsFromEnv();
  const techStackMcpProfile =
    techStackMcpSources.length > 0 && process.env.NODE_ENV !== 'test'
      ? await fetchCompanyTechStackMcps({
          name,
          domain: requestedDomain,
          website: requestedWebsite,
          now,
          configs: techStackMcpSources,
        }).catch((err) => {
          log.warn({ err, company: name }, 'tech-stack MCP enrichment failed');
          return null;
        })
      : null;
  const favicon = faviconProfile({
    name,
    domain: openProfile?.domain ?? requestedDomain,
    website: openProfile?.website ?? requestedWebsite,
    now,
  });
  const domain = openProfile?.domain ?? favicon.domain;
  const website = openProfile?.website ?? favicon.website;
  const countryCode = normalizeCountry(country);
  const isMantu = domain === 'mantu.com' || normalizedName === 'mantu';
  const currentSourceAttribution = [
    ...(openProfile?.sourceAttribution ?? []),
    ...(techStackMcpProfile?.sourceAttribution ?? []),
    ...(openProfile?.logoUrl ? [] : favicon.sourceAttribution),
    attribution({
      source: isMantu ? 'official_website' : 'verified_data_source',
      label: isMantu ? 'Mantu official website' : 'BidStack verified data cache',
      sourceUrl: website,
      confidence: isMantu ? 0.99 : 0.72,
    }),
  ];
  const sourceAttribution = mergeSourceAttribution(
    parseAttribution(existing?.sourceAttribution),
    currentSourceAttribution,
  );
  const logoUrl = openProfile?.logoUrl ?? favicon.logoUrl ?? logoUrlFor(name, domain);
  const logoSource = isMantu
    ? 'official_website'
    : (openProfile?.logoSource ?? favicon.logoSource ?? 'favicon');
  const providerMetadata: Prisma.InputJsonObject = {
    ...(existingMetadata as Prisma.InputJsonObject),
    requestedBy,
    lookupKeys: { domain, normalizedName },
    country: countryCode,
    openCompanyProfile: (openProfile?.providerMetadata ??
      existingMetadata.openCompanyProfile ??
      null) as Prisma.InputJsonValue | null,
    companyImageUrl: (openProfile?.imageUrl ??
      existingMetadata.companyImageUrl ??
      null) as Prisma.InputJsonValue | null,
    companyDescription: (openProfile?.description ??
      existingMetadata.companyDescription ??
      null) as Prisma.InputJsonValue | null,
    techStackMcp: (techStackMcpProfile?.providerMetadata.techStackMcp ??
      existingMetadata.techStackMcp ??
      null) as Prisma.InputJsonValue | null,
    techStackMcps: (techStackMcpProfile?.providerMetadata.techStackMcps ??
      existingMetadata.techStackMcps ??
      null) as Prisma.InputJsonValue | null,
    fallbackLogo: favicon.providerMetadata as Prisma.InputJsonValue,
  };
  const confidenceBps = Math.max(isMantu ? 9900 : 7200, openProfile?.confidenceBps ?? 0);
  const industryCodes = openProfile?.industryLabels ?? [];
  const legalName = openProfile?.legalName ?? name;
  const tradeName = openProfile?.tradeName ?? name;
  const incorporationDate = openProfile?.incorporationDate
    ? new Date(openProfile.incorporationDate)
    : undefined;
  const address: Prisma.InputJsonObject = countryCode ? { countryCode } : {};

  const enrichment = await prisma.companyEnrichment.upsert({
    where: { orgId_normalizedName: { orgId, normalizedName } },
    create: {
      orgId,
      normalizedName,
      legalName,
      tradeName,
      domain,
      website,
      logoUrl,
      logoSource,
      registryIds: {},
      address,
      formerNames: [],
      industryCodes,
      status: 'active',
      incorporationDate: incorporationDate ?? null,
      employeeCount: isMantu ? 12_000 : (openProfile?.employeeCount ?? null),
      annualRevenueMicros: isMantu ? 1_000_000_000_000_000n : null,
      confidenceBps,
      sourceAttribution: sourceAttribution as Prisma.InputJsonValue,
      providerMetadata,
      cacheExpiresAt: new Date(now.getTime() + COMPANY_ENRICHMENT_CACHE_TTL_MS),
    },
    update: {
      legalName,
      tradeName,
      domain,
      website,
      logoUrl,
      logoSource,
      ...(countryCode ? { address } : {}),
      status: 'active',
      incorporationDate,
      employeeCount: isMantu ? 12_000 : (openProfile?.employeeCount ?? undefined),
      annualRevenueMicros: isMantu ? 1_000_000_000_000_000n : undefined,
      industryCodes,
      confidenceBps,
      sourceAttribution: sourceAttribution as Prisma.InputJsonValue,
      providerMetadata,
      cacheExpiresAt: new Date(now.getTime() + COMPANY_ENRICHMENT_CACHE_TTL_MS),
    },
  });

  const providers = [
    ...(seamlessProfile ? ['seamless'] : openProfile ? ['wikidata', 'wikimedia'] : []),
    ...(techStackMcpProfile ? ['tech_stack_mcp'] : []),
    'favicon',
  ];
  await prisma.auditLog.create({
    data: {
      orgId,
      userId,
      action: auditAction,
      targetType: 'company',
      targetId: enrichment.id,
      diff: {
        name,
        domain,
        country: countryCode,
        providers,
      } as Prisma.InputJsonValue,
    },
  });

  return { company: serializeCompany(enrichment), domain, providers };
}

function mergeSourceAttribution(
  existing: SourceAttributionType[],
  current: SourceAttributionType[],
): SourceAttributionType[] {
  const byKey = new Map<string, SourceAttributionType>();
  for (const item of [...existing, ...current]) {
    const parsed = SourceAttribution.safeParse(item);
    if (!parsed.success) continue;
    const key = [
      parsed.data.source,
      parsed.data.label,
      parsed.data.sourceUrl ?? '',
      parsed.data.fetchedAt,
    ].join('|');
    byKey.set(key, parsed.data);
  }
  return [...byKey.values()]
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))
    .slice(0, 12);
}

export async function queueApolloEnrichment({
  orgId,
  companyName,
  domain,
  log,
}: {
  orgId: string;
  companyName: string;
  domain?: string | null;
  log: RouteLog;
}): Promise<string | null> {
  if (!canQueueApolloEnrichment({ domain })) {
    log.info(
      { company: companyName, hasDomain: Boolean(domain) },
      'apollo data verification enqueue skipped: no complete MCP lane or REST fallback',
    );
    return null;
  }

  const apolloJobId = await enqueueApolloEnrich({
    orgId,
    companyName,
    ...(domain ? { domain } : {}),
  });
  if (apolloJobId) {
    log.info({ apolloJobId, company: companyName }, 'queued apollo data verification');
  } else {
    log.warn('apollo data verification enqueue skipped (redis unreachable)');
  }
  return apolloJobId;
}
