import { z } from 'zod';

// Compliance pack wire shapes: data residency, data subject requests (GDPR
// Art. 15, 17, 20) and the retention report (Art. 5(1)(e)).

// ─── Data residency ──────────────────────────────────────────────────────────

export const DATA_REGIONS = ['eu', 'uk', 'us', 'ca'] as const;
export const DataRegion = z.enum(DATA_REGIONS);
export type DataRegion = z.infer<typeof DataRegion>;

/** PUT body. `null` means the org is not pinned to a region. */
export const OrgDataResidency = z.object({
  region: DataRegion.nullable(),
});
export type OrgDataResidency = z.infer<typeof OrgDataResidency>;

/**
 * GET response. `enforced` mirrors DATA_RESIDENCY_ENFORCE; `regionalStorage`
 * says whether a bucket is configured for the org's region.
 */
export const OrgDataResidencyView = OrgDataResidency.extend({
  enforced: z.boolean(),
  regionalStorage: z.boolean(),
});
export type OrgDataResidencyView = z.infer<typeof OrgDataResidencyView>;

export class DataResidencyError extends Error {
  constructor(region: DataRegion) {
    const suffix = region.toUpperCase();
    super(
      `Data residency: org is pinned to "${region}" but S3_BUCKET_${suffix} is not configured ` +
        'and DATA_RESIDENCY_ENFORCE=true. Refusing to write to the default bucket.',
    );
    this.name = 'DataResidencyError';
  }
}

export interface RegionalBucket {
  bucket: string | undefined;
  s3Region: string;
  regional: boolean;
}

type Env = Record<string, string | undefined>;

/**
 * Pick the object storage bucket for an org's region. A pinned org uses
 * S3_BUCKET_<REGION> / S3_REGION_<REGION> when set. Without them it falls back
 * to the default bucket, unless DATA_RESIDENCY_ENFORCE=true, which fails closed.
 */
export function resolveRegionalBucket(region: DataRegion | null, env: Env): RegionalBucket {
  const fallback: RegionalBucket = {
    bucket: env.S3_BUCKET,
    s3Region: env.S3_REGION || 'us-east-1',
    regional: false,
  };
  if (!region) return fallback;
  const suffix = region.toUpperCase();
  const bucket = env[`S3_BUCKET_${suffix}`];
  if (bucket) {
    return { bucket, s3Region: env[`S3_REGION_${suffix}`] || fallback.s3Region, regional: true };
  }
  if (env.DATA_RESIDENCY_ENFORCE === 'true') throw new DataResidencyError(region);
  return fallback;
}

// ─── Data subject requests ───────────────────────────────────────────────────

export const DataSubjectType = z.enum(['contact', 'lead', 'account_person']);
export type DataSubjectType = z.infer<typeof DataSubjectType>;

export const DataSubjectRequestKind = z.enum(['export', 'erase']);
export type DataSubjectRequestKind = z.infer<typeof DataSubjectRequestKind>;

export const DataSubjectRequestStatus = z.enum(['queued', 'running', 'done', 'failed']);
export type DataSubjectRequestStatus = z.infer<typeof DataSubjectRequestStatus>;

export const DataSubjectRequestParams = z.object({ orgId: z.string().uuid() });
export const DataSubjectRequestIdParams = z.object({
  orgId: z.string().uuid(),
  id: z.string().uuid(),
});

/** POST body. Erasure is irreversible, so a request is a dry run unless asked otherwise. */
export const DataSubjectRequestCreate = z.object({
  kind: DataSubjectRequestKind,
  subjectType: DataSubjectType,
  subjectId: z.string().uuid(),
  dryRun: z.boolean().default(true),
});
export type DataSubjectRequestCreate = z.infer<typeof DataSubjectRequestCreate>;

/** Counts per store; never carries personal values. */
export const DataSubjectReport = z.object({
  kind: DataSubjectRequestKind,
  dryRun: z.boolean(),
  subjectType: DataSubjectType,
  subjectId: z.string(),
  scrubbedFields: z.array(z.string()),
  stores: z.record(z.object({ action: z.string(), rows: z.number().int().nonnegative() })),
  retained: z.record(z.object({ rows: z.number().int().nonnegative(), basis: z.string() })),
  auditRowsPseudonymised: z.number().int().nonnegative(),
  residue: z
    .array(
      z.object({
        model: z.string(),
        field: z.string(),
        rows: z.number().int().nonnegative(),
        retained: z.boolean(),
      }),
    )
    .optional(),
});
export type DataSubjectReport = z.infer<typeof DataSubjectReport>;

export const DataSubjectRequestView = z.object({
  id: z.string().uuid(),
  kind: DataSubjectRequestKind,
  subjectType: DataSubjectType,
  subjectId: z.string().uuid(),
  dryRun: z.boolean(),
  status: DataSubjectRequestStatus,
  report: DataSubjectReport.nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type DataSubjectRequestView = z.infer<typeof DataSubjectRequestView>;

export const DataSubjectJob = z.object({
  requestId: z.string().uuid(),
  orgId: z.string().uuid(),
});
export type DataSubjectJob = z.infer<typeof DataSubjectJob>;

// ─── Retention ───────────────────────────────────────────────────────────────

export const RetentionClassReport = z.object({
  dataClass: z.string(),
  envVar: z.string(),
  days: z.number().int().positive(),
  action: z.enum(['delete', 'scrub']),
  cutoff: z.string().datetime(),
  rows: z.number().int().nonnegative(),
});

export const RetentionReport = z.object({
  mode: z.enum(['report', 'enforce']),
  dryRun: z.boolean(),
  orgId: z.string().nullable(),
  generatedAt: z.string().datetime(),
  classes: z.array(RetentionClassReport),
});
export type RetentionReport = z.infer<typeof RetentionReport>;
