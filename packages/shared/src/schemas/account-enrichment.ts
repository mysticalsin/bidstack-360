import { z } from 'zod';

/**
 * Account enrichment (2026-10-31): firmographics, hiring breakdown and
 * "Potential projects" per CRM company, from Apollo and Seamless.
 * Contract: /workspace/fleet/polo-enrichment-api.md.
 */

export const EnrichmentProviderId = z.enum(['apollo', 'seamless']);
export type EnrichmentProviderId = z.infer<typeof EnrichmentProviderId>;

export const JobFunction = z.enum([
  'data',
  'ml_ai',
  'engineering',
  'infrastructure',
  'security',
  'product',
  'design',
  'sales',
  'marketing',
  'customer_success',
  'finance',
  'people',
  'operations',
  'legal',
  'other',
]);
export type JobFunction = z.infer<typeof JobFunction>;

export const JobSeniority = z.enum([
  'intern',
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'manager',
  'director',
  'vp',
  'c_level',
]);
export type JobSeniority = z.infer<typeof JobSeniority>;

export const HiringRegion = z.enum(['EMEA', 'AMER', 'LATAM', 'APAC', 'unknown']);
export type HiringRegion = z.infer<typeof HiringRegion>;

export const FieldProvenance = z.object({
  source: EnrichmentProviderId,
  fetchedAt: z.string(),
});
export type FieldProvenance = z.infer<typeof FieldProvenance>;

export const EnrichmentLocation = z.object({
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  kind: z.enum(['hq', 'subsidiary']),
});

export const ProviderRunStatus = z.object({
  status: z.string(),
  credits: z.number().int(),
  at: z.string(),
  error: z.string().optional(),
});

export const Firmographics = z.object({
  companyId: z.string().uuid(),
  status: z.string(),
  annualRevenueUsd: z.number().nullable(),
  revenueRange: z.string().nullable(),
  employeeCount: z.number().int().nullable(),
  employeeRange: z.string().nullable(),
  headcountGrowth6m: z.number().nullable(),
  headcountGrowth12m: z.number().nullable(),
  headcountGrowth24m: z.number().nullable(),
  industry: z.string().nullable(),
  industries: z.array(z.string()),
  locations: z.array(EnrichmentLocation),
  techStack: z.array(z.string()),
  departmentHeadcount: z.record(z.string(), z.number()).nullable(),
  openJobs: z.number().int(),
  /** Field name to {source, fetchedAt}. Only fields that have a value. */
  provenance: z.record(z.string(), FieldProvenance),
  providers: z.record(z.string(), ProviderRunStatus),
  fetchedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  stale: z.boolean(),
});
export type Firmographics = z.infer<typeof Firmographics>;

export const CountBucket = z.object({ key: z.string(), count: z.number().int() });

export const HiringCluster = z.object({
  function: JobFunction,
  region: HiringRegion,
  count: z.number().int(),
  seniority: z.array(CountBucket),
  topSkills: z.array(z.string()),
  postingIds: z.array(z.string()),
});
export type HiringCluster = z.infer<typeof HiringCluster>;

export const HiringBreakdown = z.object({
  total: z.number().int(),
  byFunction: z.array(CountBucket),
  bySeniority: z.array(CountBucket),
  byRegion: z.array(CountBucket),
  topSkills: z.array(CountBucket),
  clusters: z.array(HiringCluster),
});
export type HiringBreakdown = z.infer<typeof HiringBreakdown>;

export const ProjectConfidence = z.enum(['high', 'medium', 'low']);
export type ProjectConfidence = z.infer<typeof ProjectConfidence>;

export const ProjectEvidence = z.object({
  postingId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  region: HiringRegion,
  seniority: JobSeniority,
  postedAt: z.string().nullable(),
  source: EnrichmentProviderId,
});
export type ProjectEvidence = z.infer<typeof ProjectEvidence>;

export const PotentialProject = z.object({
  /** Stable per rule and region, e.g. "data_platform:EMEA". */
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  rationale: z.string(),
  confidence: ProjectConfidence,
  region: z.string(),
  postingCount: z.number().int(),
  seniorCount: z.number().int(),
  skills: z.array(z.string()),
  evidence: z.array(ProjectEvidence),
  /** 'rules', or 'rules+llm' when the org LLM rewrote name and rationale. */
  method: z.enum(['rules', 'rules+llm']),
});
export type PotentialProject = z.infer<typeof PotentialProject>;

/** Watchdog opportunity signal derived from one potential project. */
export const EnrichmentOpportunitySignal = z.object({
  kind: z.literal('enrichment.potential_project'),
  companyId: z.string().uuid(),
  companyName: z.string(),
  projectId: z.string(),
  title: z.string(),
  detail: z.string(),
  confidence: ProjectConfidence,
  evidenceUrls: z.array(z.string()),
  observedAt: z.string(),
});
export type EnrichmentOpportunitySignal = z.infer<typeof EnrichmentOpportunitySignal>;
