// Apollo.io company enrichment worker.
//
// Job shape: { orgId, companyName, domain? }
// Calls POST https://api.apollo.io/v1/organizations/enrich, maps the response
// to the CompanyEnrichment row keyed by (orgId, normalizedName), and writes an
// audit log entry. When APOLLO_API_KEY is unset the job is a no-op (same
// stub-mode pattern as dust-poll).

import { createHmac, timingSafeEqual } from 'node:crypto';

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { COMPANY_ENRICH_APOLLO } from '@bidstack/shared';

export const QUEUE_NAME = COMPANY_ENRICH_APOLLO.name;

const APOLLO_ENDPOINT = 'https://api.apollo.io/v1/organizations/enrich';
const APOLLO_CONFIDENCE_BPS = 8500;
const APOLLO_TIMEOUT_MS = 10_000;
const APOLLO_CONCURRENCY = 5;

export const ApolloEnrichJobData = z.object({
  orgId: z.string().uuid(),
  companyName: z.string().min(1),
  domain: z.string().min(1).optional(),
  signature: z.string().min(1).optional(),
});

export type ApolloEnrichJobData = z.infer<typeof ApolloEnrichJobData>;

// The subset of Apollo's organization payload we consume. Apollo's response
// has many other fields; we permissively .passthrough() and only require what
// we map. Numbers come through as `unknown` because Apollo occasionally
// stringifies them — coerce defensively.
const ApolloOrganization = z
  .object({
    name: z.string().nullish(),
    primary_domain: z.string().nullish(),
    website_url: z.string().nullish(),
    industry: z.string().nullish(),
    estimated_num_employees: z.union([z.number(), z.string()]).nullish(),
    // Apollo returns revenue under `annual_revenue` on some plans/endpoints and
    // `organization_revenue` on others (verified live: bulk enrich returns the
    // latter). Accept both so revenue is never silently dropped.
    annual_revenue: z.union([z.number(), z.string()]).nullish(),
    organization_revenue: z.union([z.number(), z.string()]).nullish(),
    founded_year: z.union([z.number(), z.string()]).nullish(),
    logo_url: z.string().nullish(),
    organization_industries: z.array(z.string()).nullish(),
    former_names: z.array(z.string()).nullish(),
  })
  .passthrough();

const ApolloResponse = z.object({ organization: ApolloOrganization }).passthrough();

export type ApolloOrganization = z.infer<typeof ApolloOrganization>;

export interface MappedEnrichment {
  legalName: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenueMicros: bigint | null;
  incorporationDate: Date | null;
  logoUrl: string | null;
  industryCodes: string[];
  formerNames: string[];
}

interface ApolloSignaturePayload {
  orgId: string;
  companyName: string;
  domain?: string;
}

/**
 * Pure mapping from Apollo's response shape to CompanyEnrichment fields.
 * Exported so the test can verify mapping without spinning up Redis.
 */
export function mapApolloOrganization(org: ApolloOrganization): MappedEnrichment {
  const employees = coerceInt(org.estimated_num_employees);
  const revenue = coerceNumber(org.annual_revenue ?? org.organization_revenue);
  const foundedYear = coerceInt(org.founded_year);

  return {
    legalName: org.name ?? null,
    domain: normalizeDomain(org.primary_domain ?? null),
    website: org.website_url ?? null,
    industry: org.industry ?? null,
    employeeCount: employees,
    // Money in micros per Twenty/Stripe convention (CLAUDE.md).
    annualRevenueMicros: revenue === null ? null : BigInt(Math.round(revenue * 1_000_000)),
    // Apollo only exposes founded_year — anchor on Jan 1 of that year.
    incorporationDate:
      foundedYear && foundedYear > 1700 && foundedYear < 3000
        ? new Date(Date.UTC(foundedYear, 0, 1))
        : null,
    logoUrl: org.logo_url ?? null,
    industryCodes: (org.organization_industries ?? []).filter(
      (item): item is string => typeof item === 'string',
    ),
    formerNames: (org.former_names ?? []).filter(
      (item): item is string => typeof item === 'string',
    ),
  };
}

function getJobSigningSecret(): string | null {
  return process.env.BIDSTACK_JOB_SIGNING_SECRET ?? process.env.JOB_SIGNING_SECRET ?? null;
}

function canonicalApolloJobPayload(job: ApolloSignaturePayload): string {
  return JSON.stringify({
    orgId: job.orgId,
    companyName: job.companyName,
    domain: job.domain ?? null,
  });
}

export function createApolloEnrichJobSignature(
  job: ApolloSignaturePayload,
  secret: string,
): string {
  return createHmac('sha256', secret).update(canonicalApolloJobPayload(job)).digest('hex');
}

export function verifyApolloEnrichJobSignature(
  job: ApolloEnrichJobData,
  options: { secret?: string | null; nodeEnv?: string } = {},
): boolean {
  const secret = Object.prototype.hasOwnProperty.call(options, 'secret')
    ? (options.secret ?? null)
    : getJobSigningSecret();
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (!secret) return nodeEnv !== 'production';
  if (!job.signature) return false;

  const expected = createApolloEnrichJobSignature(job, secret);
  const actualBuffer = Buffer.from(job.signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function coerceInt(value: unknown): number | null {
  const n = coerceNumber(value);
  return n === null ? null : Math.trunc(n);
}

function normalizeDomain(domain: string | null): string | null {
  if (!domain) return null;
  // Lowercase first so the `^www\.` strip catches `WWW.` too.
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

// Mirrors the normalization in apps/api/src/routes/crm.ts so the upsert
// targets the same row whether the API or the worker writes it.
export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface CallApolloOptions {
  apiKey: string;
  companyName: string;
  domain?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Calls Apollo's /v1/organizations/enrich and returns the parsed organization.
 * Throws on non-2xx, network failure, or schema mismatch.
 */
export async function callApolloEnrich(options: CallApolloOptions): Promise<ApolloOrganization> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body: Record<string, string> = { organization_name: options.companyName };
  if (options.domain) body.domain = options.domain;

  const res = await fetchImpl(APOLLO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      'X-Api-Key': options.apiKey,
    },
    body: JSON.stringify(body),
    signal: options.signal ?? AbortSignal.timeout(APOLLO_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`apollo /organizations/enrich ${res.status}: ${text.slice(0, 200)}`);
  }

  const json: unknown = await res.json();
  const parsed = ApolloResponse.parse(json);
  return parsed.organization;
}

export async function startCompanyEnrichApollo(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<{ queue: Queue; worker: Worker }> {
  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: COMPANY_ENRICH_APOLLO.defaultJobOptions,
  });
  queues.push(queue);

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const data = ApolloEnrichJobData.parse(job.data);
      const jobLog = log.child({ queue: QUEUE_NAME, jobId: job.id, orgId: data.orgId });
      if (!verifyApolloEnrichJobSignature(data)) {
        jobLog.warn({ companyName: data.companyName }, 'apollo enrichment job signature rejected');
        throw new Error('Invalid Apollo enrichment job signature');
      }

      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) {
        jobLog.warn(
          { companyName: data.companyName },
          'APOLLO_API_KEY not set — Apollo enrichment is a no-op',
        );
        return { skipped: true, reason: 'APOLLO_API_KEY missing' };
      }

      const organization = await callApolloEnrich({
        apiKey,
        companyName: data.companyName,
        ...(data.domain ? { domain: data.domain } : {}),
      });
      const mapped = mapApolloOrganization(organization);

      const normalizedName = normalizeName(data.companyName);
      const sourceUrl = mapped.website ?? (mapped.domain ? `https://${mapped.domain}/` : null);
      const sourceAttribution = [
        {
          source: 'apollo_io',
          label: 'Apollo.io organization enrichment',
          sourceUrl,
          fetchedAt: new Date().toISOString(),
          confidence: 0.85,
          providerMetadata: {
            endpoint: APOLLO_ENDPOINT,
            organizationName: organization.name ?? null,
          },
        },
      ];

      const enrichment = await prisma.companyEnrichment.upsert({
        where: { orgId_normalizedName: { orgId: data.orgId, normalizedName } },
        create: {
          orgId: data.orgId,
          normalizedName,
          legalName: mapped.legalName ?? data.companyName,
          tradeName: organization.name ?? data.companyName,
          domain: mapped.domain ?? data.domain ?? null,
          website: mapped.website ?? sourceUrl,
          logoUrl: mapped.logoUrl,
          logoSource: mapped.logoUrl ? 'manual' : null,
          registryIds: {},
          formerNames: mapped.formerNames,
          industryCodes: mapped.industryCodes,
          incorporationDate: mapped.incorporationDate,
          employeeCount: mapped.employeeCount,
          annualRevenueMicros: mapped.annualRevenueMicros,
          status: 'active',
          confidenceBps: APOLLO_CONFIDENCE_BPS,
          sourceAttribution: sourceAttribution as Prisma.InputJsonValue,
          providerMetadata: {
            apolloOrganization: organization,
            mappedIndustry: mapped.industry,
          } as Prisma.InputJsonValue,
          cacheExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        update: {
          legalName: mapped.legalName ?? data.companyName,
          tradeName: organization.name ?? data.companyName,
          domain: mapped.domain ?? data.domain ?? null,
          website: mapped.website ?? sourceUrl,
          logoUrl: mapped.logoUrl,
          logoSource: mapped.logoUrl ? 'manual' : null,
          formerNames: mapped.formerNames,
          industryCodes: mapped.industryCodes,
          incorporationDate: mapped.incorporationDate,
          employeeCount: mapped.employeeCount,
          annualRevenueMicros: mapped.annualRevenueMicros,
          status: 'active',
          confidenceBps: APOLLO_CONFIDENCE_BPS,
          sourceAttribution: sourceAttribution as Prisma.InputJsonValue,
          providerMetadata: {
            apolloOrganization: organization,
            mappedIndustry: mapped.industry,
          } as Prisma.InputJsonValue,
          cacheExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      await prisma.auditLog.create({
        data: {
          orgId: data.orgId,
          action: 'crm.company.enrich.apollo',
          targetType: 'company_enrichment',
          targetId: enrichment.id,
          diff: {
            companyName: data.companyName,
            domain: mapped.domain,
            employeeCount: mapped.employeeCount,
          } as Prisma.InputJsonValue,
        },
      });

      jobLog.info(
        { enrichmentId: enrichment.id, employees: mapped.employeeCount },
        'apollo enrichment cache updated',
      );
      return { enrichmentId: enrichment.id };
    },
    { connection, concurrency: APOLLO_CONCURRENCY },
  );
  workers.push(worker);

  return { queue, worker };
}
