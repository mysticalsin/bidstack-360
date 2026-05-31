/**
 * rfp-requirement-extract.helpers.ts — schemas + pure helpers.
 *
 * No BullMQ Worker dependency — safe to import from both processor and bootstrap.
 *
 * Extracted from rfp-requirement-extract.ts (BS-R1 file-size refactor).
 */
import type pino from 'pino';

import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { RFP_REQUIREMENT_EXTRACT, RFP_EMBED_REQUIREMENT, RFP_STORY_MATCH } from '@bidstack/shared';

import { readStoredDocument } from '../lib/storage-read.js';
import { extractTextFromBufferSandboxed } from '../lib/extract-text-sandbox.js';

export const QUEUE_NAME = RFP_REQUIREMENT_EXTRACT.name;
export const EMBED_QUEUE_NAME = RFP_EMBED_REQUIREMENT.name;
export const STORY_MATCH_QUEUE_NAME = RFP_STORY_MATCH.name;

// ─── Job schema ────────────────────────────────────────────────────────────

export const JobData = z.object({
  orgId: z.string().uuid(),
  rfpRequestId: z.string().min(1),
  documentVersionId: z.string().uuid(),
  orchestrationId: z.string().uuid(),
  chunkIndex: z.number().int().min(0).default(0),
  totalChunks: z.number().int().min(1).default(1),
});
export type JobData = z.infer<typeof JobData>;

// ─── Extracted requirement schema from Dust response ───────────────────────

export const ExtractedRequirement = z.object({
  externalRef: z.string(),
  text: z.string().min(1),
  requirementType: z.string().default('functional'),
  mandatory: z.boolean().default(true),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  confidenceBps: z.number().int().min(0).max(10000).default(7000),
  sourceChunkIndex: z.number().int().min(0).default(0),
});

export const DustExtractionResponse = z.object({
  requirements: z.array(ExtractedRequirement),
});

// ─── Deterministic fallback ─────────────────────────────────────────────────

export function fallbackExtract(rawText: string): Array<z.infer<typeof ExtractedRequirement>> {
  const lines = rawText.split('\n').filter((l) => l.trim().length > 20);
  const reqPatterns = /^\s*(shall|must|should|required|the system|the vendor|bidder)/i;
  return lines
    .filter((l) => reqPatterns.test(l))
    .slice(0, 50)
    .map((text, i) => ({
      externalRef: `REQ-${String(i + 1).padStart(4, '0')}`,
      text: text.trim().slice(0, 2000),
      requirementType: 'functional',
      mandatory: true,
      priority: 'medium' as const,
      confidenceBps: 4000,
      sourceChunkIndex: 0,
    }));
}

// ─── Source-text extraction (bytes → text, idempotent) ─────────────────────

/**
 * Ensure the DocumentVersion has `extractedText`, parsing the uploaded file on
 * first run and reusing it thereafter.
 *
 * WHY here (not the orchestrator): the orchestrator runs at concurrency 1 as a
 * pure conductor — a 90s sandboxed parse there would serialise every pipeline
 * launch. requirement-extract is the sole consumer of `extractedText` and owns
 * its own retry/backoff, so the parse belongs at its doorstep.
 *
 * WHY not the shared `document-extract` worker: that worker only writes
 * `extractedText` via the bid-workspace path, which requires an opportunityId
 * and creates ComplianceMatrixRows/SourceChunks — the wrong contract for RFP
 * intake (which may have no opportunity and wants none of those artifacts).
 *
 * Idempotent: when text is already present (seeded data, a prior run, or a
 * BullMQ retry) it short-circuits before touching storage, so the expensive
 * sandboxed parse runs at most once per document.
 */
export async function ensureExtractedText(
  documentVersionId: string,
  orgId: string,
  log: pino.Logger,
): Promise<string> {
  const docVersion = await prisma.documentVersion.findFirst({
    where: { id: documentVersionId, orgId, deletedAt: null },
    select: {
      extractedText: true,
      storageKey: true,
      contentType: true,
      fileAttachment: { select: { name: true } },
    },
  });
  if (!docVersion) {
    throw new Error(`DocumentVersion ${documentVersionId} not found for org`);
  }

  // Fast-path: already extracted — skip storage + sandbox entirely.
  if (docVersion.extractedText && docVersion.extractedText.trim().length > 0) {
    return docVersion.extractedText;
  }

  await prisma.documentVersion.updateMany({
    where: { id: documentVersionId, orgId, deletedAt: null },
    data: { extractionStatus: 'running', ocrStatus: 'running' },
  });

  try {
    const stored = await readStoredDocument({ orgId, storageKey: docVersion.storageKey });
    const text = await extractTextFromBufferSandboxed({
      buffer: stored.buffer,
      contentType: docVersion.contentType,
      name: docVersion.fileAttachment?.name ?? 'document',
      sourcePath: stored.sourcePath,
    });
    if (!text || text.trim().length === 0) {
      throw new Error('Extraction produced no text — document may be empty or image-only');
    }

    await prisma.documentVersion.updateMany({
      where: { id: documentVersionId, orgId, deletedAt: null },
      data: { extractedText: text, extractionStatus: 'succeeded', ocrStatus: 'succeeded' },
    });
    log.info(
      { orgId, documentVersionId, chars: text.length },
      'rfp-requirement-extract: source text extracted',
    );
    return text;
  } catch (err) {
    // Mark the version failed so the UI surfaces the parse failure, then
    // rethrow so BullMQ applies its retry/backoff before giving up.
    await prisma.documentVersion
      .updateMany({
        where: { id: documentVersionId, orgId, deletedAt: null },
        data: { extractionStatus: 'failed', ocrStatus: 'failed' },
      })
      .catch(() => undefined);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ─── Orchestration state helpers (raw SQL) ─────────────────────────────────

// WHY explicit ::"RfpResponsePhase" casts: the phase / completedPhase strings
// MUST match the DB enum exactly — requirement_extract, story_match,
// section_draft, compliance_fill, legal_scan, proposal_compile, qa_review,
// awaiting_approval, completed — or PostgreSQL raises invalid-enum-input.
export async function updateOrchestrationPhase(
  orchestrationId: string,
  orgId: string,
  phase: string,
  completedPhase: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE rfp_orchestrations
    SET
      current_phase    = ${phase}::"RfpResponsePhase",
      completed_phases = array_append(completed_phases, ${completedPhase}),
      updated_at       = now()
    WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
  `;
}

export async function markOrchestrationFailed(
  orchestrationId: string,
  orgId: string,
  phase: string,
  reason: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE rfp_orchestrations
    SET state = 'failed', failed_phase = ${phase}::"RfpResponsePhase", failure_reason = ${reason}, updated_at = now()
    WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
  `;
}

// Terminal-for-automation state: QA review done, proposal staged for the human
// approval gate. Appends qa_review to completed_phases and moves state + phase
// to awaiting_approval. The human approve/reject route advances from here.
export async function markOrchestrationAwaitingApproval(
  orchestrationId: string,
  orgId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE rfp_orchestrations
    SET state = 'awaiting_approval',
        current_phase = 'awaiting_approval'::"RfpResponsePhase",
        completed_phases = array_append(completed_phases, 'qa_review'),
        updated_at = now()
    WHERE id = ${orchestrationId}::uuid AND org_id = ${orgId}::uuid
  `;
}

// ─── NDA-D gate ────────────────────────────────────────────────────────────
// §NDA-D — GDPR Art. 5(1)(f) / contractual confidentiality obligation.
// Documents whose parent BidDocument has metadata.ndaTier='D' must NEVER be
// sent to any AI processor. This gate is checked before any Dust call.
//
// WHY inline (not imported from api/lib): workers cannot import from apps/api.
// WHY no documentVersionId in the false-path log: existence of a Tier-D
// document must not leak to log aggregators (information-disclosure risk).
export async function isDocumentAiSafe(documentVersionId: string, orgId: string): Promise<boolean> {
  const docVersion = await prisma.documentVersion.findUnique({
    where: { id: documentVersionId, orgId },
    select: { bidDocumentId: true },
  });
  if (!docVersion?.bidDocumentId) return true; // no parent BidDocument — safe

  const bidDoc = await prisma.bidDocument.findFirst({
    where: { id: docVersion.bidDocumentId, orgId },
    select: { metadata: true },
  });
  if (!bidDoc) return true; // parent not found — safe

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- metadata is untyped Json
  const meta = bidDoc.metadata as any;
  return !(meta && meta.ndaTier === 'D');
}
