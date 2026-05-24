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
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  companyId: z.string().uuid().nullable(),
  accountId: z.string().min(1).max(255).nullable(),
  title: z.string().min(1).max(255),
  documentType: RfpDocumentType,
  status: RfpDocumentStatus,
  source: z.string().min(1).max(100),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BidDocument = z.infer<typeof BidDocument>;

export const DocumentVersion = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  bidDocumentId: z.string().uuid(),
  versionNo: z.number().int().positive(),
  fileAttachmentId: z.string().uuid().nullable(),
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
  layoutJson: z.record(z.unknown()),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
export type DocumentVersion = z.infer<typeof DocumentVersion>;

export const SourceChunk = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  bidDocumentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
  sectionPath: z.string().max(500).nullable(),
  locator: z.record(z.unknown()),
  text: z.string(),
  hash: z.string().max(128).nullable(),
  createdAt: z.string().datetime(),
});
export type SourceChunk = z.infer<typeof SourceChunk>;

export const Requirement = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  bidDocumentId: z.string().uuid().nullable(),
  documentVersionId: z.string().uuid().nullable(),
  sourceChunkId: z.string().uuid().nullable(),
  externalRef: z.string().max(100).nullable(),
  text: z.string().min(1),
  requirementType: z.string().min(1).max(100),
  mandatory: z.boolean(),
  priority: RfpRiskLevel,
  status: RequirementStatus,
  confidenceBps: z.number().int().min(0).max(10000),
  ownerId: z.string().uuid().nullable(),
  dueDate: z.string().date().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Requirement = z.infer<typeof Requirement>;

export const ComplianceMatrixRow = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  requirementId: z.string().uuid(),
  ownerId: z.string().uuid().nullable(),
  status: ComplianceRowStatus,
  risk: RfpRiskLevel,
  responseStatus: z.string().min(1).max(100),
  answerDraft: z.string().nullable(),
  evidence: z.array(z.record(z.unknown())),
  citations: z.array(z.record(z.unknown())),
  dueDate: z.string().date().nullable(),
  approvedAt: z.string().datetime().nullable(),
  approverUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ComplianceMatrixRow = z.infer<typeof ComplianceMatrixRow>;

export const ReviewIssue = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  requirementId: z.string().uuid().nullable(),
  sourceChunkId: z.string().uuid().nullable(),
  category: z.string().min(1).max(100),
  severity: RfpRiskLevel,
  status: ReviewIssueStatus,
  title: z.string().min(1).max(255),
  description: z.string(),
  recommendation: z.string().nullable(),
  ownerId: z.string().uuid().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReviewIssue = z.infer<typeof ReviewIssue>;

export const ApprovalGate = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  bidDocumentId: z.string().uuid().nullable(),
  lockedVersionId: z.string().uuid().nullable(),
  gateKey: z.string().min(1).max(100),
  status: ApprovalGateStatus,
  approverUserId: z.string().uuid().nullable(),
  decisionNotes: z.string().nullable(),
  decidedAt: z.string().datetime().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ApprovalGate = z.infer<typeof ApprovalGate>;

export const SubmissionPackage = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  name: z.string().min(1).max(255),
  status: SubmissionPackageStatus,
  contents: z.array(z.record(z.unknown())),
  receipt: z.record(z.unknown()).nullable(),
  metadata: z.record(z.unknown()),
  lockedAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SubmissionPackage = z.infer<typeof SubmissionPackage>;

export const BidDocumentRegisterRequest = z.object({
  fileAttachmentId: z.string().uuid(),
  title: z.string().min(1).max(255),
  documentType: RfpDocumentType.default('other'),
  source: z.string().min(1).max(100).default('upload'),
  metadata: z.record(z.unknown()).default({}),
});
export type BidDocumentRegisterRequest = z.infer<typeof BidDocumentRegisterRequest>;

export const RequirementCreateRequest = z.object({
  bidDocumentId: z.string().uuid(),
  documentVersionId: z.string().uuid().optional(),
  sourceChunkId: z.string().uuid().optional(),
  externalRef: z.string().min(1).max(100).optional(),
  text: z.string().min(1),
  requirementType: z.string().min(1).max(100).default('general'),
  mandatory: z.boolean().default(false),
  priority: RfpRiskLevel.default('medium'),
  confidenceBps: z.number().int().min(0).max(10000).default(0),
  ownerId: z.string().uuid().optional(),
  dueDate: z.string().date().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type RequirementCreateRequest = z.infer<typeof RequirementCreateRequest>;

export const ComplianceMatrixRowPatch = z
  .object({
    ownerId: z.string().uuid().nullable().optional(),
    status: ComplianceRowStatus.optional(),
    risk: RfpRiskLevel.optional(),
    responseStatus: z.string().min(1).max(100).optional(),
    answerDraft: z.string().nullable().optional(),
    evidence: z.array(z.record(z.unknown())).optional(),
    citations: z.array(z.record(z.unknown())).optional(),
    dueDate: z.string().date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type ComplianceMatrixRowPatch = z.infer<typeof ComplianceMatrixRowPatch>;

export const BidWorkspaceSnapshot = z.object({
  opportunityId: z.string().uuid(),
  documents: z.array(BidDocument),
  requirements: z.array(Requirement),
  matrixRows: z.array(ComplianceMatrixRow),
  reviewIssues: z.array(ReviewIssue),
  approvalGates: z.array(ApprovalGate),
  submissionPackages: z.array(SubmissionPackage),
});
export type BidWorkspaceSnapshot = z.infer<typeof BidWorkspaceSnapshot>;
