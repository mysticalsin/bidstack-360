// MSA library (2026-10-31). Hosts master service agreements per account with
// SOWs, amendments and addenda as children, versioned files (PDF/DOCX only),
// full-text search over extracted text, renewal reminders and an audit
// timeline. Backed by contract_agreements + contract_file_versions.
// API contract: /workspace/fleet/polo-msa-api.md.
import { z } from 'zod';

export const MSA_MAX_BYTES = 25 * 1024 * 1024;
export const MSA_ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export const MsaContentType = z.enum(MSA_ALLOWED_CONTENT_TYPES);
export type MsaContentType = z.infer<typeof MsaContentType>;

export const MsaKind = z.enum(['msa', 'framework', 'sow', 'amendment', 'addendum', 'nda', 'other']);
export type MsaKind = z.infer<typeof MsaKind>;
/** Kinds that can sit under a parent agreement. */
export const MSA_CHILD_KINDS = ['sow', 'amendment', 'addendum'] as const;

export const MsaStatus = z.enum(['draft', 'in_negotiation', 'active', 'expired', 'terminated', 'pending']);
export type MsaStatus = z.infer<typeof MsaStatus>;

export const MsaReminderDays = [90, 60, 30] as const;

const IsoDate = z.string().datetime();
const Tag = z.string().trim().min(1).max(40);

export const MsaLiabilityCap = z.object({
  amountMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z.string().length(3).toUpperCase(),
});
export type MsaLiabilityCap = z.infer<typeof MsaLiabilityCap>;

export const MsaUserRef = z.object({ id: z.string().uuid(), email: z.string(), name: z.string().nullable() });
export type MsaUserRef = z.infer<typeof MsaUserRef>;

export const MsaFileVersion = z.object({
  id: z.string().uuid(),
  versionNo: z.number().int().min(1),
  fileName: z.string(),
  contentType: MsaContentType,
  bytes: z.number().int(),
  sha256: z.string().length(64),
  note: z.string().nullable(),
  extractionStatus: z.enum(['pending', 'running', 'done', 'error', 'skipped']),
  createdBy: MsaUserRef.nullable(),
  createdAt: IsoDate,
});
export type MsaFileVersion = z.infer<typeof MsaFileVersion>;

export const MsaSummaryRow = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid().nullable(),
  companyName: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  kind: MsaKind,
  title: z.string(),
  reference: z.string(),
  counterparty: z.string().nullable(),
  status: MsaStatus,
  effectiveDate: IsoDate.nullable(),
  expiryDate: IsoDate.nullable(),
  autoRenew: z.boolean(),
  noticePeriodDays: z.number().int().nullable(),
  /** expiryDate minus noticePeriodDays, when both are set. */
  noticeDeadline: IsoDate.nullable(),
  daysToExpiry: z.number().int().nullable(),
  owner: MsaUserRef.nullable(),
  tags: z.array(z.string()),
  childCount: z.number().int(),
  latestVersion: MsaFileVersion.nullable(),
  updatedAt: IsoDate,
});
export type MsaSummaryRow = z.infer<typeof MsaSummaryRow>;

export const MsaDetail = MsaSummaryRow.extend({
  governingLaw: z.string().nullable(),
  liabilityCap: MsaLiabilityCap.nullable(),
  paymentTerms: z.string().nullable(),
  notes: z.string().nullable(),
  currency: z.string(),
  countries: z.array(z.string()),
  parent: z.object({ id: z.string().uuid(), title: z.string(), kind: MsaKind }).nullable(),
  children: z.array(MsaSummaryRow),
  versions: z.array(MsaFileVersion),
  createdAt: IsoDate,
});
export type MsaDetail = z.infer<typeof MsaDetail>;

export const MsaListQuery = z.object({
  companyId: z.string().uuid().optional(),
  status: z
    .union([MsaStatus, z.array(MsaStatus)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  kind: z
    .union([MsaKind, z.array(MsaKind)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  ownerId: z.string().uuid().optional(),
  tag: Tag.optional(),
  parentId: z.string().uuid().optional(),
  /** true (default): top-level agreements only; false: include children. */
  topLevel: z.enum(['true', 'false']).default('true'),
  expiringWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
  /** Matches title, reference and counterparty (case-insensitive). Use /msa/search for file text. */
  q: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(['expiry', 'updated', 'title']).default('expiry'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().min(0).default(0),
});
export type MsaListQuery = z.infer<typeof MsaListQuery>;

export const MsaListResponse = z.object({
  items: z.array(MsaSummaryRow),
  nextCursor: z.number().int().nullable(),
  total: z.number().int(),
});
export type MsaListResponse = z.infer<typeof MsaListResponse>;

const MsaWritableFields = {
  title: z.string().trim().min(1).max(300),
  reference: z.string().trim().min(1).max(255).optional(),
  counterparty: z.string().trim().max(300).nullable().optional(),
  status: MsaStatus.default('draft'),
  effectiveDate: IsoDate.nullable().optional(),
  expiryDate: IsoDate.nullable().optional(),
  autoRenew: z.boolean().default(false),
  noticePeriodDays: z.number().int().min(0).max(730).nullable().optional(),
  governingLaw: z.string().trim().max(200).nullable().optional(),
  liabilityCap: MsaLiabilityCap.nullable().optional(),
  paymentTerms: z.string().trim().max(500).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  tags: z.array(Tag).max(30).default([]),
  notes: z.string().max(4000).nullable().optional(),
};

export const MsaCreate = z.object({
  companyId: z.string().uuid(),
  kind: MsaKind.default('msa'),
  parentId: z.string().uuid().nullable().optional(),
  ...MsaWritableFields,
});
export type MsaCreate = z.infer<typeof MsaCreate>;

export const MsaPatch = z
  .object({
    title: MsaWritableFields.title.optional(),
    reference: z.string().trim().min(1).max(255).optional(),
    counterparty: MsaWritableFields.counterparty,
    status: MsaStatus.optional(),
    effectiveDate: MsaWritableFields.effectiveDate,
    expiryDate: MsaWritableFields.expiryDate,
    autoRenew: z.boolean().optional(),
    noticePeriodDays: MsaWritableFields.noticePeriodDays,
    governingLaw: MsaWritableFields.governingLaw,
    liabilityCap: MsaWritableFields.liabilityCap,
    paymentTerms: MsaWritableFields.paymentTerms,
    ownerId: MsaWritableFields.ownerId,
    tags: z.array(Tag).max(30).optional(),
    notes: MsaWritableFields.notes,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'PATCH body must contain at least one field' });
export type MsaPatch = z.infer<typeof MsaPatch>;

export const MsaUploadUrlRequest = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: MsaContentType,
  bytes: z.number().int().min(1).max(MSA_MAX_BYTES),
});
export type MsaUploadUrlRequest = z.infer<typeof MsaUploadUrlRequest>;

export const MsaUploadUrlResponse = z.object({
  uploadUrl: z.string(),
  storageKey: z.string(),
  headers: z.record(z.string()),
  maxBytes: z.number().int(),
});
export type MsaUploadUrlResponse = z.infer<typeof MsaUploadUrlResponse>;

export const MsaVersionFinalize = MsaUploadUrlRequest.extend({
  storageKey: z.string().min(1).max(500),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type MsaVersionFinalize = z.infer<typeof MsaVersionFinalize>;

export const MsaDownloadUrlResponse = z.object({
  url: z.string(),
  expiresAt: IsoDate,
  fileName: z.string(),
  sha256: z.string(),
});
export type MsaDownloadUrlResponse = z.infer<typeof MsaDownloadUrlResponse>;

export const MsaTimelineEvent = z.object({
  id: z.string(),
  at: IsoDate,
  kind: z.enum(['audit', 'milestone']),
  action: z.string(),
  actor: MsaUserRef.nullable(),
  detail: z.record(z.unknown()),
});
export type MsaTimelineEvent = z.infer<typeof MsaTimelineEvent>;

export const MsaTimelineResponse = z.object({ items: z.array(MsaTimelineEvent) });
export type MsaTimelineResponse = z.infer<typeof MsaTimelineResponse>;

export const MsaAccountSummary = z.object({
  companyId: z.string().uuid(),
  total: z.number().int(),
  byStatus: z.record(z.number().int()),
  childCounts: z.object({ sow: z.number().int(), amendment: z.number().int(), addendum: z.number().int() }),
  primary: MsaSummaryRow.nullable(),
  nextExpiry: z.object({ id: z.string().uuid(), title: z.string(), date: IsoDate, days: z.number().int() }).nullable(),
  nextNoticeDeadline: z
    .object({ id: z.string().uuid(), title: z.string(), date: IsoDate, days: z.number().int() })
    .nullable(),
  expiringWithin90Days: z.number().int(),
});
export type MsaAccountSummary = z.infer<typeof MsaAccountSummary>;

export const MsaSearchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  companyId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MsaSearchQuery = z.infer<typeof MsaSearchQuery>;

export const MsaSearchHit = z.object({
  contractId: z.string().uuid(),
  versionId: z.string().uuid(),
  versionNo: z.number().int(),
  title: z.string(),
  companyId: z.string().uuid().nullable(),
  kind: MsaKind,
  status: MsaStatus,
  rank: z.number(),
  /** Plain-text snippet; matches wrapped in [[ and ]]. */
  snippet: z.string(),
});
export type MsaSearchHit = z.infer<typeof MsaSearchHit>;

export const MsaSearchResponse = z.object({ items: z.array(MsaSearchHit) });
export type MsaSearchResponse = z.infer<typeof MsaSearchResponse>;
