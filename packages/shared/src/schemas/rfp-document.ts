import { z } from 'zod';

export const RfpDocumentType = z.enum([
  'rfp',
  'rfi',
  'rfq',
  'amendment',
  'attachment',
  'proposal',
  'reference',
  'legal',
  'pricing',
  'security',
  'other',
]);
export type RfpDocumentType = z.infer<typeof RfpDocumentType>;

export const RfpDocumentStatus = z.enum([
  'intake',
  'pending_extraction',
  'extracting',
  'ready',
  'failed',
  'superseded',
  'archived',
]);
export type RfpDocumentStatus = z.infer<typeof RfpDocumentStatus>;

export const RfpJobStatus = z.enum([
  'pending',
  'queued',
  'running',
  'retrying',
  'succeeded',
  'failed',
  'cancelled',
]);
export type RfpJobStatus = z.infer<typeof RfpJobStatus>;

export const RequirementStatus = z.enum([
  'suggested',
  'accepted',
  'in_progress',
  'answered',
  'waived',
  'rejected',
  'blocked',
]);
export type RequirementStatus = z.infer<typeof RequirementStatus>;

export const ComplianceRowStatus = z.enum([
  'open',
  'in_progress',
  'ready_for_review',
  'approved',
  'blocked',
  'waived',
]);
export type ComplianceRowStatus = z.infer<typeof ComplianceRowStatus>;

// Fusion Phase 6 — "unknown stops meaning bad": ASSESSED = real AI result,
// UNAVAILABLE = fallback ran (render "not assessed", never 0), PENDING = not
// yet attempted. Mirrors the Prisma AssessmentStatus enum.
export const AssessmentStatus = z.enum(['ASSESSED', 'UNAVAILABLE', 'PENDING']);
export type AssessmentStatus = z.infer<typeof AssessmentStatus>;

export const RfpRiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type RfpRiskLevel = z.infer<typeof RfpRiskLevel>;

export const ReviewIssueStatus = z.enum([
  'open',
  'acknowledged',
  'in_progress',
  'resolved',
  'waived',
]);
export type ReviewIssueStatus = z.infer<typeof ReviewIssueStatus>;

export const ApprovalGateStatus = z.enum(['pending', 'approved', 'rejected', 'waived']);
export type ApprovalGateStatus = z.infer<typeof ApprovalGateStatus>;

export const SubmissionPackageStatus = z.enum([
  'draft',
  'locked',
  'submitted',
  'accepted',
  'rejected',
  'archived',
]);
export type SubmissionPackageStatus = z.infer<typeof SubmissionPackageStatus>;

export const BidDocument = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  opportunityId: z.string().guid().nullable(),
  companyId: z.string().guid().nullable(),
  accountId: z.string().min(1).max(255).nullable(),
  title: z.string().min(1).max(255),
  documentType: RfpDocumentType,
  status: RfpDocumentStatus,
  source: z.string().min(1).max(100),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BidDocument = z.infer<typeof BidDocument>;

export const DocumentVersion = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  bidDocumentId: z.string().guid(),
  versionNo: z.number().int().positive(),
  fileAttachmentId: z.string().guid().nullable(),
  storageKey: z.string().min(1).max(500),
  contentType: z.string().min(1).max(100),
  bytes: z.number().int().nonnegative(),
  checksum: z.string().max(128).nullable(),
  etag: z.string().max(255).nullable(),
  sourceHash: z.string().max(128).nullable(),
  ocrStatus: RfpJobStatus,
  extractionStatus: RfpJobStatus,
  ocrEngine: z.string().max(100).nullable(),
  extractedText: z.string().nullable(),
  layoutJson: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type DocumentVersion = z.infer<typeof DocumentVersion>;

export const SourceChunk = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  bidDocumentId: z.string().guid(),
  documentVersionId: z.string().guid(),
  chunkIndex: z.number().int().nonnegative(),
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
  sectionPath: z.string().max(500).nullable(),
  locator: z.record(z.string(), z.unknown()),
  text: z.string(),
  hash: z.string().max(128).nullable(),
  createdAt: z.string().datetime(),
});
export type SourceChunk = z.infer<typeof SourceChunk>;

export const Requirement = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  opportunityId: z.string().guid().nullable(),
  bidDocumentId: z.string().guid().nullable(),
  documentVersionId: z.string().guid().nullable(),
  sourceChunkId: z.string().guid().nullable(),
  externalRef: z.string().max(100).nullable(),
  text: z.string().min(1),
  requirementType: z.string().min(1).max(100),
  mandatory: z.boolean(),
  priority: RfpRiskLevel,
  status: RequirementStatus,
  // Nullable: null = no AI confidence exists (manual entry / unavailable).
  confidenceBps: z.number().int().min(0).max(10000).nullable(),
  assessmentStatus: AssessmentStatus,
  ownerId: z.string().guid().nullable(),
  dueDate: z.string().date().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Requirement = z.infer<typeof Requirement>;

export const ComplianceMatrixRow = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  opportunityId: z.string().guid().nullable(),
  requirementId: z.string().guid(),
  ownerId: z.string().guid().nullable(),
  status: ComplianceRowStatus,
  risk: RfpRiskLevel,
  responseStatus: z.string().min(1).max(100),
  answerDraft: z.string().nullable(),
  // Confidence of the compliance-fill assessment; null until one produced it.
  confidenceBps: z.number().int().min(0).max(10000).nullable(),
  assessmentStatus: AssessmentStatus,
  evidence: z.array(z.record(z.string(), z.unknown())),
  citations: z.array(z.record(z.string(), z.unknown())),
  dueDate: z.string().date().nullable(),
  approvedAt: z.string().datetime().nullable(),
  approverUserId: z.string().guid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ComplianceMatrixRow = z.infer<typeof ComplianceMatrixRow>;

export const ReviewIssue = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  opportunityId: z.string().guid().nullable(),
  requirementId: z.string().guid().nullable(),
  sourceChunkId: z.string().guid().nullable(),
  category: z.string().min(1).max(100),
  severity: RfpRiskLevel,
  status: ReviewIssueStatus,
  title: z.string().min(1).max(255),
  description: z.string(),
  recommendation: z.string().nullable(),
  ownerId: z.string().guid().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReviewIssue = z.infer<typeof ReviewIssue>;

export const ApprovalGate = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  opportunityId: z.string().guid().nullable(),
  bidDocumentId: z.string().guid().nullable(),
  lockedVersionId: z.string().guid().nullable(),
  gateKey: z.string().min(1).max(100),
  status: ApprovalGateStatus,
  approverUserId: z.string().guid().nullable(),
  decisionNotes: z.string().nullable(),
  decidedAt: z.string().datetime().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ApprovalGate = z.infer<typeof ApprovalGate>;

export const SubmissionPackage = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  opportunityId: z.string().guid().nullable(),
  name: z.string().min(1).max(255),
  status: SubmissionPackageStatus,
  contents: z.array(z.record(z.string(), z.unknown())),
  receipt: z.record(z.string(), z.unknown()).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  lockedAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SubmissionPackage = z.infer<typeof SubmissionPackage>;

export const BidDocumentRegisterRequest = z.object({
  fileAttachmentId: z.string().guid(),
  title: z.string().min(1).max(255),
  documentType: RfpDocumentType.default('other'),
  source: z.string().min(1).max(100).default('upload'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type BidDocumentRegisterRequest = z.infer<typeof BidDocumentRegisterRequest>;

export const RequirementCreateRequest = z.object({
  bidDocumentId: z.string().guid(),
  documentVersionId: z.string().guid().optional(),
  sourceChunkId: z.string().guid().optional(),
  externalRef: z.string().min(1).max(100).optional(),
  text: z.string().min(1),
  requirementType: z.string().min(1).max(100).default('general'),
  mandatory: z.boolean().default(false),
  priority: RfpRiskLevel.default('medium'),
  // Null by default: a hand-entered requirement has no AI confidence; the old
  // default(0) rendered "0% confidence" on human-written rows.
  confidenceBps: z.number().int().min(0).max(10000).nullable().default(null),
  ownerId: z.string().guid().optional(),
  dueDate: z.string().date().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type RequirementCreateRequest = z.infer<typeof RequirementCreateRequest>;

export const ComplianceMatrixRowPatch = z
  .object({
    ownerId: z.string().guid().nullable().optional(),
    status: ComplianceRowStatus.optional(),
    risk: RfpRiskLevel.optional(),
    responseStatus: z.string().min(1).max(100).optional(),
    answerDraft: z.string().nullable().optional(),
    evidence: z.array(z.record(z.string(), z.unknown())).optional(),
    citations: z.array(z.record(z.string(), z.unknown())).optional(),
    dueDate: z.string().date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type ComplianceMatrixRowPatch = z.infer<typeof ComplianceMatrixRowPatch>;

export const BidWorkspaceSnapshot = z.object({
  opportunityId: z.string().guid(),
  documents: z.array(BidDocument),
  requirements: z.array(Requirement),
  matrixRows: z.array(ComplianceMatrixRow),
  reviewIssues: z.array(ReviewIssue),
  approvalGates: z.array(ApprovalGate),
  submissionPackages: z.array(SubmissionPackage),
});
export type BidWorkspaceSnapshot = z.infer<typeof BidWorkspaceSnapshot>;
