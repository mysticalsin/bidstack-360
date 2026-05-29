// Bid workspace helpers: schemas, types, serializers, and shared utilities.
// Used by bid-workspace.ts (snapshot + document routes) and
// bid-workspace-requirements.ts (requirement + matrix routes).

import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { type BidDocument, ComplianceMatrixRow, Requirement } from '@bidstack/shared';
import type { ApprovalGate, ReviewIssue, SubmissionPackage } from '@bidstack/shared';

// ─── Shared param schemas ────────────────────────────────────────────────────

export const WorkspaceParams = z.object({ opportunityId: z.string().uuid() });
export const MatrixParams = z.object({
  opportunityId: z.string().uuid(),
  rowId: z.string().uuid(),
});
export const RequirementCreateResult = z.object({
  requirement: Requirement,
  matrixRow: ComplianceMatrixRow,
});

// ─── Primitive utils ─────────────────────────────────────────────────────────

export function dateOnly(value: Date | null): string | null {
  return value?.toISOString().split('T')[0] ?? null;
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function jsonArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

// ─── Serializers ─────────────────────────────────────────────────────────────

export function serializeBidDocument(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  companyId: string | null;
  accountId: string | null;
  title: string;
  documentType: string;
  status: string;
  source: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof BidDocument> {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    companyId: row.companyId,
    accountId: row.accountId,
    title: row.title,
    documentType: row.documentType as z.infer<typeof BidDocument>['documentType'],
    status: row.status as z.infer<typeof BidDocument>['status'],
    source: row.source,
    metadata: jsonRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeRequirement(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  bidDocumentId: string | null;
  documentVersionId: string | null;
  sourceChunkId: string | null;
  externalRef: string | null;
  text: string;
  requirementType: string;
  mandatory: boolean;
  priority: string;
  status: string;
  confidenceBps: number;
  ownerId: string | null;
  dueDate: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof Requirement> {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    bidDocumentId: row.bidDocumentId,
    documentVersionId: row.documentVersionId,
    sourceChunkId: row.sourceChunkId,
    externalRef: row.externalRef,
    text: row.text,
    requirementType: row.requirementType,
    mandatory: row.mandatory,
    priority: row.priority as z.infer<typeof Requirement>['priority'],
    status: row.status as z.infer<typeof Requirement>['status'],
    confidenceBps: row.confidenceBps,
    ownerId: row.ownerId,
    dueDate: dateOnly(row.dueDate),
    metadata: jsonRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeMatrixRow(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  requirementId: string;
  ownerId: string | null;
  status: string;
  risk: string;
  responseStatus: string;
  answerDraft: string | null;
  evidence: unknown;
  citations: unknown;
  dueDate: Date | null;
  approvedAt: Date | null;
  approverUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof ComplianceMatrixRow> {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    requirementId: row.requirementId,
    ownerId: row.ownerId,
    status: row.status as z.infer<typeof ComplianceMatrixRow>['status'],
    risk: row.risk as z.infer<typeof ComplianceMatrixRow>['risk'],
    responseStatus: row.responseStatus,
    answerDraft: row.answerDraft,
    evidence: jsonArray(row.evidence),
    citations: jsonArray(row.citations),
    dueDate: dateOnly(row.dueDate),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approverUserId: row.approverUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeReviewIssue(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  requirementId: string | null;
  sourceChunkId: string | null;
  category: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  recommendation: string | null;
  ownerId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ReviewIssue {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    requirementId: row.requirementId,
    sourceChunkId: row.sourceChunkId,
    category: row.category,
    severity: row.severity as z.infer<typeof ReviewIssue>['severity'],
    status: row.status as z.infer<typeof ReviewIssue>['status'],
    title: row.title,
    description: row.description,
    recommendation: row.recommendation,
    ownerId: row.ownerId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeApprovalGate(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  bidDocumentId: string | null;
  lockedVersionId: string | null;
  gateKey: string;
  status: string;
  approverUserId: string | null;
  decisionNotes: string | null;
  decidedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ApprovalGate {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    bidDocumentId: row.bidDocumentId,
    lockedVersionId: row.lockedVersionId,
    gateKey: row.gateKey,
    status: row.status as z.infer<typeof ApprovalGate>['status'],
    approverUserId: row.approverUserId,
    decisionNotes: row.decisionNotes,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    metadata: jsonRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeSubmissionPackage(row: {
  id: string;
  orgId: string;
  opportunityId: string | null;
  name: string;
  status: string;
  contents: unknown;
  receipt: unknown;
  metadata: unknown;
  lockedAt: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SubmissionPackage {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    name: row.name,
    status: row.status as z.infer<typeof SubmissionPackage>['status'],
    contents: jsonArray(row.contents),
    receipt: row.receipt === null ? null : jsonRecord(row.receipt),
    metadata: jsonRecord(row.metadata),
    lockedAt: row.lockedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Shared DB helper ─────────────────────────────────────────────────────────

export async function ensureOpportunity(orgId: string, opportunityId: string) {
  return prisma.opportunity.findFirst({
    where: { id: opportunityId, orgId, deletedAt: null },
    select: { id: true, companyId: true, customer: true },
  });
}
